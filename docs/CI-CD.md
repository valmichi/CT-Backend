# Pruebas y CI/CD con GitHub Actions

Este documento describe la estrategia de pruebas automatizadas y el pipeline de integración y entrega continua (CI/CD) del backend de Cyber Tycoon.

- Rama de trabajo: `ci/github-actions-tests` (creada desde `main` para no alterar lo que ya funciona).
- Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- Herramientas: Jest 29 (framework de pruebas) y Supertest 7 (peticiones HTTP a Express sin abrir un puerto).

---

## 1. Cambios realizados en el proyecto

| Archivo | Cambio | Motivo |
|---|---|---|
| `src/app.js` | `app.listen()` solo se ejecuta si el archivo se corre directamente (`require.main === module`) y se exporta `app`. | Permite importar la app desde las pruebas sin levantar el servidor. `npm start` funciona igual que antes. |
| `package.json` | Se agregan `jest` y `supertest` como `devDependencies` y los scripts `test`, `test:unit`, `test:integration`, `test:coverage`. | Ejecutar las pruebas en local y en CI. |
| `jest.config.js` | Configuración de Jest (entorno Node, cobertura). | |
| `tests/setup-env.js` | Variables de entorno por defecto para las pruebas. | Las pruebas no dependen del `.env` local. |
| `tests/unit/` | Pruebas unitarias (sin base de datos). | |
| `tests/integration/` | Pruebas de integración contra MySQL real. | |
| `.github/workflows/ci.yml` | Pipeline de GitHub Actions. | |

No se modificó ninguna ruta, consulta SQL ni lógica de negocio.

---

## 2. Cómo ejecutar las pruebas en local

```bash
npm install
npm run test:unit        # Pruebas unitarias (no requieren MySQL)
npm run test:coverage    # Unitarias + reporte de cobertura en coverage/
```

Pruebas de integración (requieren MySQL con `database/init.sql` cargado):

```bash
mysql -u root -p < database/init.sql
# PowerShell
$env:RUN_INTEGRATION="true"; $env:DB_PASSWORD="<tu_password>"; npm run test:integration
# Bash
RUN_INTEGRATION=true DB_PASSWORD=<tu_password> npm run test:integration
```

Sin `RUN_INTEGRATION=true` la suite de integración se omite (aparece como *skipped*).

> **Aviso:** `init.sql` borra y recrea las tablas. No ejecutes las pruebas de integración contra una base con datos reales.

---

## 3. Pipeline de GitHub Actions

### Disparadores

- `push` a `main`, `ci/**` y `feature/**`
- `pull_request` hacia `main`
- Ejecución manual (`workflow_dispatch`) desde la pestaña **Actions**

### Jobs

```
lint ──┬── unit-tests (Node 18, 20, 22) ──┐
       └── integration-tests (MySQL 8) ───┴── smoke-test ── package (solo main)

security-audit (en paralelo, informativo)
```

| Job | Qué hace | ¿Bloquea? |
|---|---|---|
| **lint** | `npm ci` y `node --check` sobre todos los `.js` de `src`, `tests` y `public/js`. | Sí |
| **unit-tests** | Ejecuta las pruebas unitarias en Node 18, 20 y 22. Sube el reporte de cobertura como artefacto (`coverage-report`). | Sí |
| **integration-tests** | Levanta un contenedor `mysql:8.0`, carga `database/init.sql` y ejecuta el flujo completo de la API. | Sí |
| **smoke-test** | Arranca el servidor con `npm start` (solo dependencias de producción) y verifica que `/api/health` y `/admin-dashboard/` respondan. | Sí |
| **security-audit** | `npm audit --omit=dev --audit-level=high`. | No (`continue-on-error`) |
| **package (CD)** | Solo en `push` a `main`: genera `cyber-tycoon-api-<sha>.tar.gz` listo para desplegar y lo publica como artefacto. | — |

### Secretos

El workflow usa valores de prueba (`JWT_SECRET`, `ADMIN_REGISTRATION_KEY`) definidos solo para CI. Las claves reales de producción nunca deben subirse al repositorio; si en el futuro se agrega un despliegue automático, configúralas en **Settings → Secrets and variables → Actions** y léelas con `${{ secrets.NOMBRE }}`.

---

## 4. Casos de prueba

### 4.1 Unitarias — `tests/unit/auth.middleware.test.js`

| # | Caso | Resultado esperado |
|---|---|---|
| U1 | Petición sin token | 401 |
| U2 | Token con formato inválido | 403 |
| U3 | Token firmado con otra clave | 403 |
| U4 | Token expirado | 403 |
| U5 | Token válido | `next()` y `req.usuario` con el payload |
| U6 | `requerirProfesor` con rol estudiante | 403 |
| U7 | `requerirProfesor` con rol profesor | `next()` |

### 4.2 Unitarias — `tests/unit/api.validaciones.test.js`

La base de datos se reemplaza por un *mock* de Jest.

| # | Caso | Resultado esperado |
|---|---|---|
| A1 | `GET /api/health` con BD disponible | 200, `status: OK` |
| A2 | `GET /api/health` con BD caída | 500 |
| A3 | Cabeceras Helmet | Sin `X-Powered-By`, con `Content-Security-Policy` |
| A4 | Login estudiante sin campos | 400, no consulta la BD |
| A5 | Login con código de clase inexistente | 404, código normalizado a mayúsculas |
| A6 | Login en clase inactiva | 403 |
| A7 | Registro de profesor sin campos | 400 |
| A8 | Registro con clave maestra incorrecta | 403, no consulta la BD |
| A9 | `GET /api/profesor/clases` sin token | 401 |
| A10 | `GET /api/profesor/clases` con token de estudiante | 403 |
| A11 | `POST /api/tienda/comprar` sin token | 401 |
| A12 | `POST /api/tienda/comprar` sin `id_producto` | 400 |
| A13 | Cuerpo mayor a 10kb | Rechazado, no llega a la BD |
| A14 | Cuerpo mayor a 10kb devuelve 413 | **Bug conocido B4** |

### 4.3 Integración — `tests/integration/flujo-completo.test.js`

Flujo real de punta a punta contra MySQL 8:

| # | Caso | Resultado esperado |
|---|---|---|
| I1 | Health check con MySQL real | 200 |
| I2 | Registrar profesor con clave maestra | 201 |
| I3 | Registrar el mismo correo otra vez | 400 |
| I4 | Login profesor con contraseña incorrecta | 401 |
| I5 | Login profesor correcto | 200 + JWT |
| I6 | Crear clase | 201, código `CT-XXXXX` |
| I7 | Listar clases del profesor | Contiene la clase creada |
| I8 | Dar de alta a un estudiante | 201 |
| I9 | Login de estudiante no registrado | 403 |
| I10 | Login de estudiante (código en minúsculas) | 200, 1000 créditos |
| I11 | Catálogo de la tienda | 6 productos semilla o más |
| I12 | Comprar servidor con saldo suficiente | **Bug conocido B1** |
| I13 | Consultar inventario | **Bug conocido B2** |
| I14 | Métricas de alumnos de la clase | 200, incluye al alumno |
| I15 | Borrar clase con alumnos | **Bug conocido B3** |

---

## 5. Bugs encontrados por las pruebas

Las pruebas detectaron defectos reales que **no se corrigieron en esta rama** para no cambiar el comportamiento del proyecto sin aprobación del equipo. Están marcadas con `test.failing`: el pipeline pasa mientras el bug siga presente, y **falla en cuanto alguien lo corrija**, como recordatorio para cambiar `test.failing` por `test`.

| ID | Archivo | Problema | Impacto | Corrección sugerida |
|---|---|---|---|---|
| B1 | `src/routes/tienda.routes.js` | `mysql2` devuelve las columnas `DECIMAL` como texto. `user.creditos < prod.costo` compara `"1000.00" < "250.00"` como cadenas, lo cual es `true`. | El alumno recibe "Créditos insuficientes" aunque sí tenga saldo. | Convertir con `Number(user.creditos)` y `Number(prod.costo)` antes de comparar y operar, o usar `decimalNumbers: true` en el pool. |
| B2 | `src/routes/tienda.routes.js` (`/inventario`) | La consulta usa `inventario_usuario` y `catalogo_productos` en minúsculas. En MySQL sobre Linux los nombres de tabla distinguen mayúsculas. | Funciona en Windows, pero responde 500 en un servidor Linux. | Usar `Inventario_Usuario` y `Catalogo_Productos`. |
| B3 | `database/init.sql` | `fk_usuarios_clases` está definida como `ON DELETE RESTRICT`, pero la ruta de borrar clase promete borrado en cascada. | Borrar una clase con alumnos responde 500. | Cambiar la FK a `ON DELETE CASCADE`. |
| B4 | `src/app.js` | El manejador central de errores responde siempre 500, aunque el error tenga su propio código (por ejemplo 413). | Los clientes reciben 500 en lugar de 413 Payload Too Large. | Responder con `err.status \|\| 500`. |

### Auditoría de dependencias

`npm audit --omit=dev` reporta vulnerabilidades en dependencias transitivas (`body-parser`, `proxy-addr`, `ip-address`), todas con corrección disponible vía `npm audit fix`. El job es informativo y no bloquea el pipeline.

---

## 6. Resultados

### Ejecución local (Windows, Node 20.11.1)

```
Test Suites: 1 skipped, 2 passed, 2 of 3 total
Tests:       15 skipped, 21 passed, 36 total
Cobertura (solo unitarias): 34% de líneas
```

La suite de integración se omite en local porque requiere MySQL; se ejecuta en GitHub Actions.

### Ejecución en GitHub Actions

_Pendiente: completar tras el primer push de la rama._

| Job | Estado | Duración | Enlace |
|---|---|---|---|
| lint | | | |
| unit-tests (18/20/22) | | | |
| integration-tests | | | |
| smoke-test | | | |
| security-audit | | | |

---

## 7. Flujo de trabajo para el equipo

1. Crear la rama desde `main`: `git switch -c <tipo>/<descripcion>`.
2. Hacer cambios y ejecutar `npm run test:unit` antes de cada commit.
3. Subir la rama: `git push -u origin <rama>`. GitHub Actions ejecuta el pipeline.
4. Abrir un Pull Request hacia `main`. El pipeline corre de nuevo sobre el PR.
5. Fusionar solo con todos los jobs en verde y la revisión de al menos un compañero.

Recomendación: en **Settings → Branches** agregar una regla de protección para `main` que exija los checks `unit-tests`, `integration-tests` y `smoke-test` antes de fusionar.
