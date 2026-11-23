# CLAUDE.md — Cyber Tycoon

> Este archivo existe **igual** en la raíz de los dos repositorios (backend y frontend) y en
> `Documents/` del autor original. Si lo cambias en uno, copia el cambio a los otros.
> Las secciones 1–5 son el **diseño del juego** (la meta). Las secciones 6–11 describen
> **cómo está construido hoy**, cómo trabajamos y qué falta.

## 1. Descripción General
**Cyber Tycoon** es un videojuego móvil tipo *tycoon* (simulador de gestión) sobre administración de centros de datos y ciberseguridad. El jugador administra su presupuesto, instala y escala hardware en racks, genera ingresos pasivos y atiende incidentes o solicitudes de servicio (tickets) evitando fallos operativos. Se usa en clase: un **profesor** da de alta grupos y alumnos en un panel web y monitorea el progreso de cada Data Center.

---

## 2. Principio Arquitectónico (Regla de Oro)
El sistema sigue un modelo de **Cliente Ligero con Backend Autoritativo**:
- **Toda la lógica crítica vive en el servidor:** validación de compras, espacio en racks, cálculos de ingresos pasivos, consumo eléctrico, aumento de temperatura, resolución de tickets, penalizaciones, cambios de reputación y detección de *Game Over*.
- **El cliente (Godot) no decide reglas de negocio:** solo envía intenciones del jugador vía API REST asíncrona, recibe el estado actualizado y renderiza la interfaz.

---

## 3. Stack Tecnológico y Entorno
- **Frontend (Cliente Móvil):** Godot Engine 4.6 (GDScript).
- **Backend (API REST):** Node.js 20 + Express 5.
- **Base de Datos:** MySQL 8.0 (esquema relacional con integridad referencial).
- **Autenticación:** JWT (JSON Web Tokens).
- **Entorno Local:** Docker y Docker Compose en Windows (PowerShell).
- **Servidor del equipo:** Orange Pi 5 Pro (Ubuntu, ARM64) con Docker Compose, expuesto por Tailscale Funnel en `https://cybertycoon-server.tail45d52a.ts.net`.

---

## 4. Mecánicas de Juego (Core Loop)

### Ciclo Principal
El jugador equilibra su **capacidad de infraestructura** frente a la **demanda de trabajo (tickets)** y los **riesgos operativos** (sobrecalentamiento, sobrecarga eléctrica y pérdida de estabilidad) para hacer crecer su centro de datos.

### Sistema de Tickets y Reputación
- **Tickets:** Solicitudes de servicio o incidentes que llegan al centro de datos y representan la demanda activa.
- **Aceptar un ticket:** Compromete recursos (CPU/TFLOPS, RAM, red) y aumenta la carga térmica/operativa. Completarlo otorga dinero y sube la **reputación**; fallarlo penaliza dinero y reputación.
- **Rechazar un ticket:** Evita sobrecargar la infraestructura cuando no hay capacidad suficiente, pero reduce directamente la **reputación**.
- **Reputación:** Métrica de prestigio corporativo acotada estrictamente en `[0, 100]` (`CLAMP(valor, 0, 100)`). Condiciona el crecimiento y la calidad/valor de los contratos entrantes. Si llega a `0`, dispara **Game Over formal**.

### Recursos y Métricas Críticas
- **CPU (TFLOPS) y Memoria (RAM):** Capacidad total de cómputo disponible para sostener operaciones y atender tickets simultáneos.
- **Temperatura:** Sube según el hardware activo y la carga de trabajo, mitigada por los sistemas de enfriamiento.
- **Energía (Carga eléctrica):** Cada equipo encendido consume energía; el consumo total no puede superar la capacidad suministrada.
- **Espacio físico en Racks:** Capacidad limitada por slots/unidades; no se puede instalar hardware sin espacio disponible.

### Tienda y Categorías de Dispositivos (3 Tiers)
Progresión de hardware en **3 niveles (tiers)** divididos en 4 categorías complementarias (no intercambiables):
1. **Servidores:** Aportan capacidad productiva (CPU/TFLOPS y RAM); consumen espacio, energía y generan calor.
2. **Enfriamiento (Cooling):** Contrarrestan la temperatura generada por el hardware activo.
3. **Red (Networking):** Habilitan y escalan la conectividad/tráfico para procesar tickets sin cuellos de botella.
4. **Unidades de Energía (Power Units):** Proveen el suministro eléctrico para alimentar el resto del equipo.

---

## 5. Casos Borde, Validaciones y Reglas Anti-Softlock
(✅ = implementado · ⏳ = pendiente, ver §10)

### Temperatura (3 Rangos)
- ✅ **Zona Segura (`<= 70 °C`):** Operación al 100%, ingresos pasivos normales.
- ✅ **Zona de Advertencia / *Thermal Throttling* (`71 °C – 85 °C`):** Se permite operar e instalar hardware, pero el backend aplica `-40%` a los ingresos pasivos y devuelve `status: "WARNING"` + `warning: "HIGH_TEMPERATURE"` para alertar en Godot. Un ticket **entregado** en esta zona paga `-25%` de créditos (la reputación no cambia; el evento `COMPLETADO` trae `recorte_temperatura: true` y `recompensa_completa`). Los tiempos de entrega no cambian.
- ✅ **Zona Crítica (`> 85 °C`):** **Apagado de Emergencia**. La temperatura es una sola para todo el Data Center. El backend apaga servidores del que más calor genera al que menos (si no basta, equipos de red; nunca refrigeración ni energía) solo hasta volver a `<= 85 °C`, y los marca con `motivo_apagado = "OVERHEATED"`. Las acciones del jugador que causan el sobrecalentamiento se permiten (el apagado corre en la misma petición). Los tickets en proceso que se quedan sin capacidad fallan en ese momento con su penalización normal; no hay castigo extra. Un equipo `OVERHEATED` no se puede reencender (`409 OVERHEATED`) mientras volvería a pasar de 85 °C: hay que mejorar *Cooling* o apagar otros equipos.

### Energía (Preventiva y Reactiva)
- ✅ **Instalación / Encendido:** Validar `consumo_activo + consumo_nuevo <= capacidad_energia_total`. Si no alcanza, rechazar con `409 Conflict` (`INSUFFICIENT_POWER`). Se permite comprar hardware (queda instalado pero **apagado**) y no encenderlo hasta cubrir la energía.
- ✅ **Venta / Apagado de *Power Unit*:** Si quitarla deja `consumo_activo > nueva_capacidad`, rechazar con `409 Conflict` (`POWER_IN_USE`) exigiendo apagar servidores primero.
- ⏳ **Sobrecarga reactiva (incidente eléctrico):** Si un evento reduce la capacidad por debajo del consumo actual, ejecutar **Apagón Parcial (*Brownout*)**: desactivar servidores automáticamente (del último instalado al primero) hasta equilibrar el consumo.

### Reputación en Cero (Game Over Formal) — ✅
- La reputación nunca baja de `0` ni supera `100`.
- Si `reputacion == 0`, el backend cambia `Usuarios.estado_partida` a `GAME_OVER` y bloquea las acciones operativas (compras, encender/apagar, vender, tickets, incidentes) con `409` + `codigo: "GAME_OVER"`.
- El frontend detecta `GAME_OVER`, bloquea la navegación, muestra un modal con estadísticas finales y ofrece reiniciar con `POST /api/usuario/reset`.

### Anti-Softlock y Concurrencia
- ✅ **Recuperación:** El jugador siempre puede **vender hardware** (recupera el 50% del costo) y **apagar/encender** servidores sin desinstalarlos (apagado conserva su espacio, consume `0` energía y genera `0` calor).
- ✅ **Tickets sin capacidad:** Al aceptar, validar `capacidad_libre >= requerido` (libre = total − lo reservado por tickets en proceso); si no alcanza, `409 Conflict` (`INSUFFICIENT_RESOURCES`).
- ✅ **Tickets expirados:** Si un ticket caduca sin respuesta (incluso con la app cerrada), al recalcular estado el backend lo marca `expirado` y aplica la misma penalización que un rechazo.
- ✅ **Doble clic / Concurrencia:** Compras, ventas, encendido y tickets corren en transacciones SQL con la fila del usuario bloqueada (`SELECT ... FOR UPDATE`) y devuelven `409` (`ALREADY_PROCESSED`) ante duplicados.

### Tabla Resumen de Respuestas del Backend
| Escenario | Regla de Backend | Efecto en Juego | Código / Estado |
| :--- | :--- | :--- | :--- |
| **Temp. Advertencia (`71–85 °C`)** ✅ | Permitir operación + multiplicador | `-40%` ingresos pasivos, `-25%` créditos de tickets entregados, alerta en UI | `200 OK` + `status: "WARNING"` |
| **Temp. Crítica (`> 85 °C`)** ✅ | Apagado de emergencia (más caliente primero) | Ingresos del equipo a `0`, fallan sus tickets | evento `APAGADO_EMERGENCIA` · reencender: `409 OVERHEATED` |
| **Energía insuficiente al encender** ✅ | Bloquear encendido / comprar apagado | Equipo queda `OFF` | `409 Conflict` (`INSUFFICIENT_POWER`) |
| **Venta/apagado de *Power Unit* en uso** ✅ | Bloquear si rompe balance eléctrico | Obliga a apagar servidores primero | `409 Conflict` (`POWER_IN_USE`) |
| **Sin CPU/RAM/Red para ticket** ✅ | Bloquear aceptación del ticket | Jugador debe rechazar o mejorar equipo | `409 Conflict` (`INSUFFICIENT_RESOURCES`) |
| **Reputación llega a `0`** ✅ | `CLAMP(rep, 0, 100)` + fin de partida | Modal de estadísticas y reinicio vía API | `estado_partida: "GAME_OVER"` / `409 GAME_OVER` |
| **Doble clic en compra/ticket** ✅ | Transacción SQL + bloqueo de fila | Evita cobros o recompensas duplicadas | `409 Conflict` (`ALREADY_PROCESSED`) |

---

## 6. Backend (repo `CT-Backend`, carpeta local `backend/`)

### Estructura
```
src/app.js                      Express: helmet, CORS, rate limit, montaje de rutas
src/config/db.js                Pool mysql2
src/config/juego.js             TODAS las constantes de balance (base del Data Center,
                                3 racks x 14 U, reembolso, reputación 0-100, TICKETS: tiempos,
                                intervalos, penalizaciones, desbloqueo por dificultad;
                                INGRESOS: créditos/TFLOP/min, tope acumulable; TEMPERATURA: zonas)
src/config/tickets.catalogo.js  50 solicitudes de clientes (portadas del diseño de Godot)
src/services/estado.service.js  Métricas = base + equipos ENCENDIDOS (nunca sumas/restas a mano);
                                racks y huecos contiguos; reservas de tickets; caché en Usuarios;
                                zona de temperatura e ingreso por minuto (funciones puras)
src/services/ingresos.service.js Cobro de ingresos pasivos desde Usuarios.ultimo_cobro
src/services/termica.service.js  Apagado de emergencia > 85 °C (protegerTemperatura)
src/services/partida.service.js Clamp de reputación, GAME_OVER, reinicio
src/services/tickets.service.js Ciclo de tickets: expirar, entregar, generar (procesarTickets);
                                fallarPorCapacidad tras un apagado de emergencia
src/routes/*.routes.js          auth, usuario, tienda, inventario, tickets, eventos, profesor, admin...
database/init.sql               Esquema completo (solo corre con el volumen de MySQL vacío)
database/migrations/NNN_*.sql   Cambios para bases ya existentes (ver §8)
tests/unit                      Jest con la BD simulada (mock de src/config/db)
tests/integration               Jest + Supertest contra MySQL real (RUN_INTEGRATION=true)
public/                         Panel docente web (/admin-dashboard)
```

### API del jugador (JWT de alumno)
| Método y ruta | Qué hace |
| :--- | :--- |
| `POST /api/auth/login` `{nombreUsuario, codigo_clase}` | Login de alumno (dado de alta por el profesor) |
| `GET /api/usuario/dashboard` | Cobra ingresos pasivos, procesa tickets y devuelve `{estado_partida, metricas{creditos, reputacion, teraflops, memoria, ancho_banda, temperatura, carga_electrica, capacidad_watts, espacio_usado, espacio_total, ingreso_por_minuto, ingreso_base_por_minuto, multiplicador_ingresos, status ("OK"\|"WARNING"), warning ("HIGH_TEMPERATURE"\|null), reservado, libre}, estadisticas, racks[], tickets{pendientes,en_proceso}, eventos[]}`. Si se cobró ≥ 60 s de golpe, `eventos` trae `{tipo: "INGRESO_PASIVO", creditos, segundos}` |
| `POST /api/usuario/reset` | Reinicia la partida ($1000, reputación 50) |
| `GET /api/tienda/catalogo` · `POST /api/tienda/comprar {id_producto}` | Catálogo y compra (asigna rack/slot; si falta energía queda apagado) |
| `GET /api/inventario` · `POST /api/inventario/:id/estado {encendido}` · `POST /api/inventario/:id/vender` | Inventario (con `motivo_apagado`), encender/apagar, vender. Comprar, encender/apagar y vender devuelven también `eventos` (p. ej. `APAGADO_EMERGENCIA`) |
| `GET /api/tickets` | Procesa y devuelve `{activos, recientes, eventos, estado}` |
| `POST /api/tickets/:id/aceptar` · `POST /api/tickets/:id/rechazar` | Aceptar (reserva capacidad) / rechazar (−5 rep) |
| `GET /api/tickets/pendientes` · `POST /api/tickets/generar-demo` · `POST /api/tickets/resolver` | Compatibilidad y pruebas |
| `/api/eventos/*` | Incidentes aleatorios (existen en backend; **sin UI en Godot todavía**) |

Las respuestas que cambian el estado traen `estado` (mismo formato que el dashboard) para que Godot lo aplique al momento. Errores: `{ error: "mensaje para el jugador", codigo: "INSUFFICIENT_POWER" | ... }`. Evento de apagado: `{tipo: "APAGADO_EMERGENCIA", temperatura_antes, temperatura_despues, equipos: [{id_inventario, nombreProducto}]}`, seguido de un `{tipo: "FALLIDO", motivo: "OVERHEATED", ...}` por cada ticket que falló. En `racks[].equipos[]` viene `sobrecalentado: true`.

### Reglas internas que hay que respetar
- Las métricas se **recalculan** con `estado.recalcularYGuardar()` después de cualquier cambio; las columnas `teraflopsCD`, `temperaturaCD`, etc. de `Usuarios` son solo **caché** (las lee el panel docente).
- **Ingresos pasivos:** `1` crédito por TFLOP de **servidor encendido** por minuto (los TFLOPS base no pagan), `-40%` en advertencia, tope de 120 min acumulables. `ingresos.cobrarIngresos()` cobra lo generado desde `Usuarios.ultimo_cobro` (reloj de MySQL) y avanza ese reloj solo lo cobrado. Se llama en dashboard y `GET /api/tickets`, y **antes** de comprar, encender/apagar o vender (para que el tramo anterior se pague con la tasa y temperatura previas). Cualquier ruta nueva que cambie equipos debe cobrar primero. En `GAME_OVER` no se paga y el reinicio deja `ultimo_cobro = NOW()`.
- **Apagado de emergencia:** `termica.protegerTemperatura()` va **después** de cualquier cambio que pueda calentar (comprar, encender/apagar, vender) y en dashboard / `GET /api/tickets`, siempre antes de `recalcularYGuardar()`. Orden en cada petición: cobrar ingresos → cambio → proteger temperatura → recalcular. Cualquier ruta nueva que cambie equipos debe proteger la temperatura después. Encender o apagar a mano borra `motivo_apagado`.
- El bloqueo por `GAME_OVER` se revisa **dentro** de la transacción (no como middleware global): las pruebas unitarias simulan la BD y un middleware con consulta las rompería.
- Los tiempos de tickets se calculan con el reloj de **MySQL** (`NOW()`, `TIMESTAMPDIFF`) y se mandan como `segundos_para_decidir / segundos_para_entregar`; el cliente nunca usa su propia hora para decidir nada.
- El panel docente usa `/api/profesor/*` (token con `rol: 'admin'`). `src/routes/clases.routes.js` es código muerto (exige un rol que no existe).

## 7. Frontend (repo `cyber-tycoon`, carpeta local `frontend/`)
- **Escena inicial:** `res://login/Login.tscn` (login pixel art) → `res://Escenas/Dashboard.tscn`.
- **`Scripts/Session.gd`:** token JWT y **`base_url` en la línea 9** (servidor del equipo; para pruebas locales `http://127.0.0.1:3000`, ver `README Profesor.md`).
- **`Scripts/GameData.gd` (autoload):** hace el papel de `ApiClient` + `GameState` del diseño original. Guarda el estado que manda el servidor (`aplicar_estado`) y hace todas las peticiones (un `HTTPRequest` por llamada, timeout 10 s, 401/403 → `sesion_expirada`, `409 GAME_OVER` → refresca). Las pantallas escuchan sus señales (`estado_actualizado`, `tickets_recibidos`, `ticket_respuesta`, `equipo_cambiado`, `equipo_vendido`, `partida_reiniciada`...).
- **`Dashboard.gd`:** consulta el dashboard cada 5 s, abre Tienda/Tickets/Inventario como ventanas sobre `OverlayLayer`, barras con unidades, globo de tickets pendientes, `GameOverModal.gd` (creado por código). Junto a los créditos muestra `+$X/min` (naranja si hay recorte); con `status: "WARNING"` la barra de temperatura se pone roja y aparece un aviso debajo; el evento `INGRESO_PASIVO` (señal `GameData.ingreso_pasivo_cobrado`) muestra un aviso flotante. El evento `APAGADO_EMERGENCIA` (señal `GameData.apagado_emergencia`) muestra un aviso flotante rojo con los equipos apagados y los tickets que fallaron. Los racks parpadean en rojo en la zona de advertencia.
- **`Helpdesk.gd` + `TicketCard.gd`:** consultan `GET /api/tickets` cada 3 s y sincronizan tarjetas por `id_ticket`. Sin sesión (escena corrida con F6) usan la **simulación local** (`RequestScheduler` + `RequestCatalog`), que copia los valores del servidor: reputación 0–100, desbloqueo media ≥ 60 / difícil ≥ 80, reputación por dificultad 3/5 · 6/9 · 12/16, −5 al rechazar o caducar, 120 s para decidir. Si cambian en `juego.js`, hay que cambiarlos también en `RequestCatalog.gd`. El aviso de ticket recortado por temperatura (señal `GameData.ticket_recortado`) lo muestra el Dashboard.
- **`Inventario.gd` + `InventoryItemCard.gd`:** encender/apagar y VENDER (doble toque) contra el servidor; pestaña Energía creada por código. Un equipo apagado por emergencia se ve rojizo con el texto "SOBRECALENTADO"; tras un apagado de emergencia se vuelve a pedir el inventario.
- **`Rack.gd`:** una franja por U; un equipo de 2U pinta 2 franjas (verde = encendido, gris = apagado, rojo oscuro = apagado por emergencia).
- **Convención:** los elementos nuevos de UI se crean **por código** para no requerir cambios manuales en el Inspector. Si algo sí requiere Inspector, indícalo explícitamente al final.

## 8. Cómo trabajamos (flujo acordado)
1. **Idioma:** todo en español (código, comentarios, mensajes y conversación).
2. **Paso a paso:** primero se corrigen errores existentes y luego se implementa lo pendiente, una tarea a la vez. Antes de una decisión de diseño grande, se explica y se pregunta.
3. **Ramas:** cada tarea en una rama `feature/...` en cada repo. `main` siempre estable (es lo que corre la Orange Pi).
4. **El usuario hace los commits y push él mismo.** Claude le da los comandos exactos de PowerShell, **uno por bloque**, y le avisa qué archivos NO incluir.
5. **Nunca subir `Session.gd` con `127.0.0.1`.** En el frontend se agregan los archivos con nombre (no `git add .`) cuando `Session.gd` tiene la URL local.
6. **Cambios de base de datos:** se actualiza `database/init.sql` **y** se agrega `database/migrations/NNN_descripcion.sql` (número consecutivo, comentado, seguro de correr una vez). Hoy existen 001–006.
7. **Despliegue en la Orange Pi** (lo hace un compañero por SSH; darle **comandos de una sola línea**, ya que los de varias líneas se pegaron mal antes):
   ```bash
   cd ~/CT-Backend && git pull origin main && docker compose up -d --build
   for f in database/migrations/*.sql; do echo "== $f"; docker exec -i ct-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 cyber_tycoon' < "$f"; done
   ```
   `Duplicate column name ...` en una migración = ya estaba aplicada. Primero se actualiza el backend del servidor y después se publica el juego.
8. **Verificar antes de dar algo por hecho:** lint + pruebas + prueba real en Godot (§9). Reportar con honestidad lo que no se pudo probar.

## 9. Cómo probar
- **Backend rápido:** `npm run lint` y `npm run test:unit` (sin base de datos).
- **Backend completo** (igual que el CI, con un MySQL temporal que se borra al final; requiere Docker Desktop abierto). Desde Git Bash en `backend/`:
  ```bash
  docker network create ct-ci-tmp; docker run -d --rm --name ct-ci-mysql --network ct-ci-tmp -e MYSQL_ROOT_PASSWORD=root mysql:8.0
  # esperar a que responda: docker exec ct-ci-mysql mysqladmin ping -h 127.0.0.1 -proot
  docker exec -i ct-ci-mysql mysql -uroot -proot < database/init.sql
  MSYS_NO_PATHCONV=1 docker run --rm --network ct-ci-tmp -v "$(pwd -W):/src:ro" -e RUN_INTEGRATION=true -e DB_HOST=ct-ci-mysql -e DB_USER=root -e DB_PASSWORD=root -e DB_NAME=cyber_tycoon -e JWT_SECRET=x -e ADMIN_REGISTRATION_KEY=clave_maestra_pruebas node:20 sh -c "mkdir /app && cd /src && tar --exclude=node_modules --exclude=.git --exclude=.env -cf - . | tar -xf - -C /app && cd /app && npm ci && npx jest --runInBand"
  docker rm -f ct-ci-mysql; docker network rm ct-ci-tmp
  ```
  Estado al 2026-11-22: **149 pruebas pasan**.
- **Backend local para jugar:** `docker compose up -d --build` en `backend/`, aplicar migraciones (comando en `README Profesor.md`) y poner `base_url` local.
- **Godot sin interfaz:** con `Godot_v4.6.1-stable_win64_console.exe --headless --path <frontend> --script res://tests/_tmp_algo.gd` se puede escribir un script temporal (`extends SceneTree`) que haga login, abra escenas y llame métodos; **borrarlo al terminar**. Ojo: ese script **no debe nombrar clases que usan el autoload `GameData`** (p. ej. `TicketCard`), o Godot las compila antes de que exista el autoload y las carga rotas.

## 10. Estado actual y pendientes (2026-11-22)

### Hecho
- Login nuevo, sesión única en `Session.gd`, regreso al Login si el token expira.
- Estado 100% del servidor: Dashboard con datos reales, barras con unidades, racks 3×14 U con franjas por equipo, inventario con encender/apagar y vender, energía con `INSUFFICIENT_POWER` / `POWER_IN_USE`.
- Reputación 0–100, `GAME_OVER` y reinicio (modal en Godot).
- Ciclo completo de tickets en el servidor (llegan cada 45 s, máx. 5 activos, 120 s para decidir, 120 s de entrega, reserva de capacidad, falla si se apaga equipo en medio, −5 por rechazar/expirar, dificultad por reputación: media ≥ 60, difícil ≥ 80).
- Acentos del catálogo reparados (migración 002) y `init.sql` con `SET NAMES utf8mb4`.
- Ingresos pasivos (1 crédito/TFLOP/min de servidores encendidos, tope 120 min) y zona de advertencia (> 70 °C: −40 %, `status: "WARNING"`), con `Usuarios.ultimo_cobro` (migración 005) y aviso en el Dashboard.
- Zona crítica (> 85 °C): apagado de emergencia del servidor más caliente primero, tickets en proceso sin capacidad fallan al momento, `409 OVERHEATED` al reencender sin enfriamiento (migración 006, `Inventario_Usuario.motivo_apagado`); aviso rojo en Dashboard, rack e inventario.
- Tickets entregados en zona de advertencia pagan −25 % de créditos (aviso naranja en el Dashboard). La simulación local de tickets (`RequestCatalog.gd`) usa la escala 0–100 del servidor.

### Pendiente (en este orden)
1. **Apagón parcial (*brownout*).**
2. **Incidentes (`/api/eventos`) en Godot:** el backend existe; falta la pantalla.
3. Probar de punta a punta `INSUFFICIENT_POWER` / `POWER_IN_USE` con unidades de energía reales.
4. Menores: panel docente sin `estado_partida`; endurecer el registro docente (`crypto.timingSafeEqual` para la clave maestra, dominio de correo, contraseña mínima); el profesor de ejemplo de `init.sql` tiene un hash inválido; borrar el login viejo (`Escenas/Login.tscn`, `Escenas/login.gd`) cuando se confirme que ya no se usa.

## 11. Trampas conocidas
- **Acentos:** el cliente `mysql` del contenedor usa latin1; los `.sql` deben empezar con `SET NAMES utf8mb4` y ejecutarse con `--default-character-set=utf8mb4`. En PowerShell 5.1 **no** pasar SQL por tubería (`Get-Content | docker exec`), porque daña los acentos: copiar el archivo con `docker cp` (ver `README Profesor.md`).
- **Colación:** `utf8mb4_unicode_ci` ignora acentos (`'Ã'` = `'A'`); para comparar bytes usar `COLLATE utf8mb4_bin`.
- **Decimales:** `mysql2` devuelve `DECIMAL` como texto; convertir con `Number()` antes de sumar o comparar.
- **Fin de línea:** las advertencias de Git "LF will be replaced by CRLF" son normales.
