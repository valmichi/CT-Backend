// Incidentes del Data Center (eventos aleatorios) y APAGÓN PARCIAL (brownout).
//
//  - El servidor los genera solo: uno al azar entre INTERVALO_MIN y INTERVALO_MAX
//    segundos después del anterior (Usuarios.proximo_incidente), máximo uno activo.
//  - El jugador tiene SEGUNDOS_RESPUESTA para elegir UNA acción de las opciones
//    (la correcta + distractores). Acertar: +créditos, +reputación. Fallar o no
//    responder a tiempo: −créditos, −reputación (puede llevar a GAME_OVER).
//  - FALLA_ELECTRICA: mientras está activo, la capacidad eléctrica baja
//    (estado.cargarAjustesEnergia). Si el consumo queda por encima, se apagan
//    servidores del último instalado al primero (motivo_apagado = 'BROWNOUT') y
//    fallan los tickets en proceso que se quedan sin capacidad. Al terminar el
//    incidente (bien o mal) la capacidad vuelve; los equipos apagados se quedan
//    apagados hasta que el jugador los encienda.
//
// Todo corre dentro de la transacción con la fila del usuario bloqueada.
const { INCIDENTES } = require('../config/juego');
const catalogo = require('../config/incidentes.catalogo');
const estado = require('./estado.service');
const partida = require('./partida.service');
const tickets = require('./tickets.service');

const BROWNOUT = 'BROWNOUT';
const num = (valor) => Number(valor || 0);

// ----------------------------------------------------------------------
// Funciones puras (se prueban en tests/unit)
// ----------------------------------------------------------------------

const segundosHastaSiguiente = (aleatorio = Math.random) =>
  INCIDENTES.INTERVALO_MIN_SEGUNDOS +
  Math.floor(aleatorio() * (INCIDENTES.INTERVALO_MAX_SEGUNDOS - INCIDENTES.INTERVALO_MIN_SEGUNDOS + 1));

const barajar = (lista, aleatorio = Math.random) => {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
};

// La acción correcta + distractores al azar, en orden al azar.
const armarOpciones = (accionCorrecta, aleatorio = Math.random) => {
  const otras = barajar(Object.keys(catalogo.ACCIONES).filter((a) => a !== accionCorrecta), aleatorio);
  return barajar([accionCorrecta, ...otras.slice(0, INCIDENTES.OPCIONES_POR_INCIDENTE - 1)], aleatorio);
};

const elegirIncidente = (tipo = null, aleatorio = Math.random) =>
  catalogo.INCIDENTES.find((i) => i.tipo === tipo) ||
  catalogo.INCIDENTES[Math.floor(aleatorio() * catalogo.INCIDENTES.length)];

const parsearOpciones = (valor) => {
  if (Array.isArray(valor)) return valor;
  try { return JSON.parse(valor || '[]'); } catch { return []; }
};

// Lo que recibe Godot. Nunca incluye accion_requerida.
const formatearIncidente = (fila) => {
  if (!fila) return null;
  const plantilla = catalogo.INCIDENTES.find((i) => i.tipo === fila.tipo);
  return {
    id_incidente: Number(fila.id_incidente),
    tipo: fila.tipo,
    titulo: plantilla ? plantilla.titulo : fila.tipo,
    descripcion: fila.descripcion,
    opciones: parsearOpciones(fila.opciones_json).map((id) => ({ id, texto: catalogo.ACCIONES[id] || id })),
    segundos_restantes: fila.segundos_restantes === null || fila.segundos_restantes === undefined
      ? null
      : Math.max(0, num(fila.segundos_restantes)),
    recompensa_creditos: num(fila.recompensa_creditos),
    penalizacion_creditos: num(fila.penalizacion_creditos),
    recompensa_reputacion: num(fila.recompensa_reputacion),
    penalizacion_reputacion: num(fila.penalizacion_reputacion),
    fecha_creacion: fila.fecha_creacion
  };
};

// ----------------------------------------------------------------------
// Base de datos
// ----------------------------------------------------------------------

const SELECT_INCIDENTE = `SELECT i.*, TIMESTAMPDIFF(SECOND, NOW(), i.fecha_limite) AS segundos_restantes
  FROM Incidentes_Activos i`;

const registrar = (conn, id_usuario, tipo, descripcion) =>
  conn.query(
    'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
    [id_usuario, tipo, descripcion.slice(0, 255)]
  );

const cargarActivo = async (conn, id_usuario) => {
  const [filas] = await conn.query(
    `${SELECT_INCIDENTE} WHERE i.id_usuario = ? AND i.estado = 'activo' ORDER BY i.id_incidente LIMIT 1`,
    [id_usuario]
  );
  return filas[0] || null;
};

const cargarIncidente = async (conn, id_usuario, id_incidente) => {
  const [filas] = await conn.query(
    `${SELECT_INCIDENTE} WHERE i.id_incidente = ? AND i.id_usuario = ? FOR UPDATE`,
    [id_incidente, id_usuario]
  );
  return filas[0] || null;
};

const programarSiguiente = (conn, id_usuario) =>
  conn.query(
    'UPDATE Usuarios SET proximo_incidente = NOW() + INTERVAL ? SECOND WHERE id_usuario = ?',
    [segundosHastaSiguiente(), id_usuario]
  );

// Apagón parcial: apaga del último instalado al primero hasta que el consumo
// quepa en la capacidad reducida. Devuelve [APAGON_PARCIAL, ...FALLIDO] o [].
const aplicarApagon = async (conn, id_usuario) => {
  const items = await estado.cargarInventario(conn, id_usuario);
  const ajustes = await estado.cargarAjustesEnergia(conn, id_usuario);
  const ids = estado.planApagonParcial(items, ajustes);
  if (ids.length === 0) return [];

  const antes = estado.calcularMetricas(items, ajustes);
  await conn.query(
    'UPDATE Inventario_Usuario SET encendido = FALSE, motivo_apagado = ? WHERE id_usuario = ? AND id_inventario IN (?)',
    [BROWNOUT, id_usuario, ids]
  );
  const apagados = items.filter((i) => ids.includes(i.id_inventario));
  for (const item of apagados) item.encendido = false;
  const despues = estado.calcularMetricas(items, ajustes);

  await registrar(
    conn, id_usuario, 'APAGON_PARCIAL',
    `Apagón parcial (${antes.carga_electrica} W > ${antes.capacidad_watts} W): ${apagados.map((i) => i.nombreProducto).join(', ')}`
  );
  const evento = {
    tipo: 'APAGON_PARCIAL',
    id_ticket: null,
    titulo: null,
    creditos: 0,
    reputacion: 0,
    capacidad_watts: antes.capacidad_watts,
    carga_antes: antes.carga_electrica,
    carga_despues: despues.carga_electrica,
    equipos: apagados.map((i) => ({ id_inventario: i.id_inventario, nombreProducto: i.nombreProducto }))
  };
  const fallidos = await tickets.fallarPorCapacidad(conn, id_usuario, BROWNOUT);
  return [evento, ...fallidos];
};

// Crea un incidente (tipo al azar si no se indica). Devuelve { fila, eventos }.
const generarIncidente = async (conn, id_usuario, tipo = null) => {
  const plantilla = elegirIncidente(tipo);
  const [r] = await conn.query(
    `INSERT INTO Incidentes_Activos
       (id_usuario, tipo, descripcion, accion_requerida, opciones_json, penalizacion_creditos,
        penalizacion_reputacion, recompensa_creditos, recompensa_reputacion, fecha_limite)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? SECOND)`,
    [
      id_usuario, plantilla.tipo, plantilla.descripcion, plantilla.accion_requerida,
      JSON.stringify(armarOpciones(plantilla.accion_requerida)),
      plantilla.penalizacion_creditos, INCIDENTES.REPUTACION_FALLO,
      plantilla.recompensa_creditos, INCIDENTES.REPUTACION_ACIERTO,
      INCIDENTES.SEGUNDOS_RESPUESTA
    ]
  );
  await registrar(conn, id_usuario, 'INCIDENTE', `Incidente: ${plantilla.titulo}`);
  const fila = await cargarIncidente(conn, id_usuario, r.insertId);
  const eventos = [{ tipo: 'INCIDENTE', id_incidente: r.insertId, titulo: plantilla.titulo, creditos: 0, reputacion: 0 }];
  if (plantilla.tipo === 'FALLA_ELECTRICA') eventos.push(...(await aplicarApagon(conn, id_usuario)));
  return { fila, eventos };
};

// Cierra un incidente activo como resuelto (exito) o fallido y aplica
// créditos / reputación / GAME_OVER. Devuelve el evento y el usuario actualizado.
const cerrarIncidente = async (conn, id_usuario, inc, exito, motivo) => {
  const [[u]] = await conn.query(
    'SELECT creditos, reputacion, ataquesResueltos, estado_partida FROM Usuarios WHERE id_usuario = ?',
    [id_usuario]
  );
  const creditosAntes = num(u.creditos);
  const repAntes = num(u.reputacion);
  const deltaCreditos = exito ? num(inc.recompensa_creditos) : -Math.min(creditosAntes, num(inc.penalizacion_creditos));
  const reputacion = partida.clampReputacion(repAntes + (exito ? num(inc.recompensa_reputacion) : -num(inc.penalizacion_reputacion)));
  const estadoPartida = partida.estadoTrasReputacion(reputacion, u.estado_partida);
  const ataques = num(u.ataquesResueltos) + (exito && inc.tipo === 'ATAQUE_SEGURIDAD' ? 1 : 0);

  await conn.query(
    'UPDATE Usuarios SET creditos = ?, reputacion = ?, ataquesResueltos = ?, estado_partida = ? WHERE id_usuario = ?',
    [creditosAntes + deltaCreditos, reputacion, ataques, estadoPartida, id_usuario]
  );
  await conn.query(
    'UPDATE Incidentes_Activos SET estado = ?, fecha_resolucion = NOW() WHERE id_incidente = ?',
    [exito ? 'resuelto' : 'fallido', inc.id_incidente]
  );
  await programarSiguiente(conn, id_usuario);
  await registrar(
    conn, id_usuario, exito ? 'INCIDENTE_RESUELTO' : 'INCIDENTE_FALLIDO',
    `${exito ? 'Mitigó' : motivo === 'EXPIRADO' ? 'No atendió a tiempo' : 'Acción errónea ante'} ${inc.tipo}`
  );
  return {
    evento: {
      tipo: exito ? 'INCIDENTE_RESUELTO' : 'INCIDENTE_FALLIDO',
      id_incidente: Number(inc.id_incidente),
      titulo: (catalogo.INCIDENTES.find((i) => i.tipo === inc.tipo) || {}).titulo || inc.tipo,
      motivo: exito ? null : motivo,
      creditos: deltaCreditos,
      reputacion: reputacion - repAntes
    },
    creditos: creditosAntes + deltaCreditos,
    reputacion,
    estado_partida: estadoPartida
  };
};

// Se llama en cada consulta del dashboard: expira el incidente vencido y, si
// toca, genera uno nuevo. Devuelve los eventos para el cliente.
const procesarIncidentes = async (conn, id_usuario, { generar = true } = {}) => {
  const [[u]] = await conn.query(
    'SELECT estado_partida, proximo_incidente, proximo_incidente <= NOW() AS toca FROM Usuarios WHERE id_usuario = ?',
    [id_usuario]
  );
  if (!u || partida.esGameOver(u)) return [];
  const eventos = [];

  const activo = await cargarActivo(conn, id_usuario);
  if (activo) {
    if (activo.segundos_restantes === null || num(activo.segundos_restantes) > 0) return eventos;
    const r = await cerrarIncidente(conn, id_usuario, activo, false, 'EXPIRADO');
    eventos.push(r.evento);
    if (r.estado_partida === partida.GAME_OVER) return eventos;
    return eventos; // el siguiente llegará cuando toque (proximo_incidente)
  }

  if (!generar) return eventos;
  if (u.proximo_incidente === null || u.proximo_incidente === undefined) {
    await programarSiguiente(conn, id_usuario); // primera vez: el primero llega en 2-4 min
    return eventos;
  }
  if (Number(u.toca) === 1) {
    const g = await generarIncidente(conn, id_usuario);
    eventos.push(...g.eventos);
  }
  return eventos;
};

module.exports = {
  BROWNOUT,
  segundosHastaSiguiente,
  armarOpciones,
  elegirIncidente,
  formatearIncidente,
  cargarActivo,
  cargarIncidente,
  generarIncidente,
  cerrarIncidente,
  procesarIncidentes,
  aplicarApagon
};
