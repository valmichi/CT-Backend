// Cálculo autoritativo del estado del Data Center.
//
// Las métricas (TFLOPS, RAM, ancho de banda, temperatura, energía y espacio)
// NO se suman/restan a mano en cada ruta: se recalculan siempre a partir de los
// valores base + el inventario (solo los equipos encendidos aportan capacidad,
// consumen energía y generan calor; apagados siguen ocupando espacio). Después
// se guardan como caché en las columnas de Usuarios, que siguen leyendo el
// panel docente y la resolución de tickets.
const {
  BASE,
  TEMPERATURA_MINIMA,
  NUM_RACKS,
  U_POR_RACK,
  ESPACIO_TOTAL,
  PORCENTAJE_REEMBOLSO,
  INGRESOS,
  TEMPERATURA
} = require('../config/juego');

// ----------------------------------------------------------------------
// Funciones puras (sin base de datos): se prueban en tests/unit
// ----------------------------------------------------------------------

const num = (valor) => Number(valor || 0);
const vacio = (valor) => valor === null || valor === undefined;

// Normaliza una fila de Inventario_Usuario JOIN Catalogo_Productos.
const normalizarItem = (fila) => ({
  id_inventario: Number(fila.id_inventario),
  id_producto: Number(fila.id_producto),
  nombreProducto: fila.nombreProducto,
  categoria: fila.categoria,
  costo: num(fila.costo),
  espacioNecesario: num(fila.espacioNecesario),
  aumento_teraflops: num(fila.aumento_teraflops),
  impacto_temperatura: num(fila.impacto_temperatura),
  aumento_memoria: num(fila.aumento_memoria),
  impacto_anchoDeBanda: num(fila.impacto_anchoDeBanda),
  consumoElectrico: num(fila.consumoElectrico),
  aumento_watts: num(fila.aumento_watts),
  encendido: Boolean(Number(fila.encendido)),
  rack_numero: vacio(fila.rack_numero) ? null : Number(fila.rack_numero),
  slot_inicio: vacio(fila.slot_inicio) ? null : Number(fila.slot_inicio),
  fecha_compra: fila.fecha_compra
});

const precioVenta = (costo) => Math.round(num(costo) * PORCENTAJE_REEMBOLSO * 100) / 100;

// Suma los aportes de los equipos. Devuelve las métricas en sus unidades reales.
const calcularMetricas = (items) => {
  const m = {
    teraflops: BASE.teraflops,
    memoria: BASE.memoria,
    ancho_banda: BASE.ancho_banda,
    temperatura: BASE.temperatura,
    carga_electrica: BASE.carga_electrica,
    capacidad_watts: BASE.capacidad_watts,
    espacio_usado: 0,
    espacio_total: ESPACIO_TOTAL
  };

  for (const item of items) {
    m.espacio_usado += item.espacioNecesario; // encendido o apagado, ocupa su lugar
    if (!item.encendido) continue;
    m.teraflops += item.aumento_teraflops;
    m.memoria += item.aumento_memoria;
    m.ancho_banda += item.impacto_anchoDeBanda;
    m.temperatura += item.impacto_temperatura;
    m.carga_electrica += item.consumoElectrico;
    m.capacidad_watts += item.aumento_watts;
  }

  m.temperatura = Math.max(TEMPERATURA_MINIMA, m.temperatura);
  return m;
};

// --- Temperatura e ingresos pasivos (CLAUDE.md §5) ---

// 'OK' (<= 70 °C) o 'WARNING' (> 70 °C). La zona crítica (> 85 °C) aún no
// apaga equipos (pendiente 2): mientras tanto se trata como advertencia.
const zonaTemperatura = (temperatura) => (temperatura > TEMPERATURA.ADVERTENCIA ? 'WARNING' : 'OK');

const multiplicadorTemperatura = (temperatura) =>
  (zonaTemperatura(temperatura) === 'WARNING' ? TEMPERATURA.MULTIPLICADOR_ADVERTENCIA : 1);

const redondear2 = (valor) => Math.round(valor * 100) / 100;

// Ingreso pasivo por minuto: solo SERVIDORES encendidos, según sus TFLOPS,
// con el recorte de la zona de temperatura en la que está el Data Center.
const calcularIngresos = (items, temperatura = calcularMetricas(items).temperatura) => {
  const teraflops = items
    .filter((i) => i.encendido && i.categoria === 'Servidor')
    .reduce((suma, i) => suma + i.aumento_teraflops, 0);
  const base = teraflops * INGRESOS.CREDITOS_POR_TFLOP_MIN;
  const status = zonaTemperatura(temperatura);
  const multiplicador = multiplicadorTemperatura(temperatura);
  return {
    ingreso_base_por_minuto: redondear2(base),
    ingreso_por_minuto: redondear2(base * multiplicador),
    multiplicador_ingresos: multiplicador,
    status,
    warning: status === 'WARNING' ? 'HIGH_TEMPERATURE' : null
  };
};

// Cuánto cobrar por `segundos` transcurridos (con el tope de horas acumulables).
const calcularCobro = (segundos, porMinuto) => {
  const transcurridos = Math.max(0, Math.floor(num(segundos)));
  const cobrables = Math.min(transcurridos, INGRESOS.MAX_MINUTOS_ACUMULABLES * 60);
  return {
    segundos: cobrables,
    excedido: transcurridos > cobrables,
    monto: redondear2((porMinuto * cobrables) / 60)
  };
};

// Mapa de ocupación: [rack][slot] = id_inventario | null
const mapaOcupacion = (items) => {
  const mapa = Array.from({ length: NUM_RACKS }, () => Array(U_POR_RACK).fill(null));
  for (const item of items) {
    if (item.rack_numero === null || item.slot_inicio === null) continue;
    for (let i = 0; i < item.espacioNecesario; i++) {
      const slot = item.slot_inicio + i;
      if (slot < U_POR_RACK) mapa[item.rack_numero - 1][slot] = item.id_inventario;
    }
  }
  return mapa;
};

// Primer hueco contiguo donde quepa un equipo de `espacio` U (un equipo no se
// parte entre dos racks). Devuelve { rack_numero, slot_inicio } o null.
const buscarHueco = (items, espacio) => {
  if (espacio < 1 || espacio > U_POR_RACK) return null;
  const mapa = mapaOcupacion(items);
  for (let r = 0; r < NUM_RACKS; r++) {
    let libresSeguidos = 0;
    for (let s = 0; s < U_POR_RACK; s++) {
      libresSeguidos = mapa[r][s] === null ? libresSeguidos + 1 : 0;
      if (libresSeguidos === espacio) {
        return { rack_numero: r + 1, slot_inicio: s - espacio + 1 };
      }
    }
  }
  return null;
};

// Racks tal como los dibuja Godot (Dashboard / carrusel).
const construirRacks = (items) => {
  const racks = Array.from({ length: NUM_RACKS }, (_, i) => ({
    id_rack: i + 1,
    espacio_total: U_POR_RACK,
    espacio_usado: 0,
    equipos: []
  }));
  for (const item of items) {
    if (item.rack_numero === null) continue;
    const rack = racks[item.rack_numero - 1];
    rack.espacio_usado += item.espacioNecesario;
    rack.equipos.push({
      id_inventario: item.id_inventario,
      nombreProducto: item.nombreProducto,
      categoria: item.categoria,
      slot_inicio: item.slot_inicio,
      espacio: item.espacioNecesario,
      encendido: item.encendido
    });
  }
  for (const rack of racks) rack.equipos.sort((a, b) => a.slot_inicio - b.slot_inicio);
  return racks;
};

const SIN_RESERVAS = Object.freeze({ teraflops: 0, memoria: 0, ancho_banda: 0 });

// Capacidad que queda libre después de lo que apartan los tickets en proceso.
const capacidadLibre = (metricas, reservas = SIN_RESERVAS) => ({
  teraflops: metricas.teraflops - reservas.teraflops,
  memoria: metricas.memoria - reservas.memoria,
  ancho_banda: metricas.ancho_banda - reservas.ancho_banda
});

// Respuesta estándar de estado que consume Godot (GameData.aplicar_estado).
const formatearEstado = (usuario, items, reservas = SIN_RESERVAS) => {
  const metricas = calcularMetricas(items);
  return {
    estado_partida: usuario.estado_partida || 'ACTIVE',
    metricas: {
      creditos: num(usuario.creditos),
      reputacion: num(usuario.reputacion),
      ...metricas,
      // ingreso_por_minuto, status ('OK' | 'WARNING'), warning ('HIGH_TEMPERATURE' | null)
      ...calcularIngresos(items, metricas.temperatura),
      // Lo que apartan los tickets aceptados (en proceso) y lo que queda libre
      reservado: { ...reservas },
      libre: capacidadLibre(metricas, reservas)
    },
    // Lo que muestra el modal de fin de partida (y sirve al docente).
    estadisticas: {
      contratos_finalizados: num(usuario.contratos_finalizados),
      ataques_resueltos: num(usuario.ataquesResueltos),
      equipos: items.length
    },
    racks: construirRacks(items)
  };
};

// ----------------------------------------------------------------------
// Acceso a base de datos (siempre con la conexión de la transacción activa)
// ----------------------------------------------------------------------

const cargarInventario = async (conn, id_usuario) => {
  const [filas] = await conn.query(
    `SELECT iu.id_inventario, iu.id_producto, iu.encendido, iu.rack_numero, iu.slot_inicio,
            iu.fecha_compra, cp.nombreProducto, cp.categoria, cp.costo, cp.espacioNecesario,
            cp.aumento_teraflops, cp.impacto_temperatura, cp.aumento_memoria,
            cp.impacto_anchoDeBanda, cp.consumoElectrico, cp.aumento_watts
     FROM Inventario_Usuario iu
     JOIN Catalogo_Productos cp ON iu.id_producto = cp.id_producto
     WHERE iu.id_usuario = ?
     ORDER BY iu.id_inventario`,
    [id_usuario]
  );
  return filas.map(normalizarItem);
};

// Suma de TFLOPS / RAM / ancho de banda apartados por los tickets en proceso.
const cargarReservas = async (conn, id_usuario) => {
  const [filas] = await conn.query(
    `SELECT COALESCE(SUM(teraflops_requeridos), 0) AS teraflops,
            COALESCE(SUM(memoriaRequerida), 0) AS memoria,
            COALESCE(SUM(anchoDeBanda_requerido), 0) AS ancho_banda
     FROM Tickets_Soporte WHERE id_usuario = ? AND estado = 'en_proceso'`,
    [id_usuario]
  );
  return { teraflops: num(filas[0].teraflops), memoria: num(filas[0].memoria), ancho_banda: num(filas[0].ancho_banda) };
};

// Equipos comprados antes de que existieran rack_numero/slot_inicio: se les
// asigna lugar en orden de compra. Si alguno ya no cabe, se queda sin rack.
const asegurarUbicaciones = async (conn, items) => {
  const ubicados = items.filter((i) => i.rack_numero !== null);
  for (const item of items) {
    if (item.rack_numero !== null) continue;
    const hueco = buscarHueco(ubicados, item.espacioNecesario);
    if (!hueco) continue;
    item.rack_numero = hueco.rack_numero;
    item.slot_inicio = hueco.slot_inicio;
    ubicados.push(item);
    await conn.query(
      'UPDATE Inventario_Usuario SET rack_numero = ?, slot_inicio = ? WHERE id_inventario = ?',
      [hueco.rack_numero, hueco.slot_inicio, item.id_inventario]
    );
  }
  return items;
};

// Recalcula y guarda la caché de métricas en Usuarios. Devuelve el estado
// listo para responder al cliente.
const recalcularYGuardar = async (conn, id_usuario) => {
  const [usuarios] = await conn.query('SELECT * FROM Usuarios WHERE id_usuario = ?', [id_usuario]);
  if (usuarios.length === 0) return null;

  const items = await asegurarUbicaciones(conn, await cargarInventario(conn, id_usuario));
  const m = calcularMetricas(items);

  await conn.query(
    `UPDATE Usuarios SET
       teraflopsCD = ?, temperaturaCD = ?, memoriaDisponibleCD = ?, ancho_bandaCD = ?,
       carga_electrica_actual = ?, capacidad_watts = ?, espacioFisicoDisponible = ?
     WHERE id_usuario = ?`,
    [
      m.teraflops, m.temperatura, m.memoria, m.ancho_banda,
      m.carga_electrica, m.capacidad_watts, m.espacio_total - m.espacio_usado,
      id_usuario
    ]
  );

  const reservas = await cargarReservas(conn, id_usuario);
  return { usuario: usuarios[0], items, reservas, estado: formatearEstado(usuarios[0], items, reservas) };
};

module.exports = {
  normalizarItem,
  precioVenta,
  calcularMetricas,
  zonaTemperatura,
  multiplicadorTemperatura,
  calcularIngresos,
  calcularCobro,
  buscarHueco,
  construirRacks,
  formatearEstado,
  capacidadLibre,
  cargarReservas,
  cargarInventario,
  asegurarUbicaciones,
  recalcularYGuardar
};
