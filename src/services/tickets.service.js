// Ciclo de vida autoritativo de los tickets (CLAUDE.md §4 y §5):
//
//   pendiente --aceptar--> en_proceso --(llega fecha_entrega)--> completado | fallido
//       |  \--rechazar--> rechazado
//       \--(pasa fecha_limite sin respuesta)--> expirado
//
//  - Aceptar APARTA TFLOPS / RAM / ancho de banda (409 INSUFFICIENT_RESOURCES si no alcanza).
//  - Al llegar la fecha de entrega se completa si el Data Center todavía tiene la
//    capacidad comprometida; si se apagaron o vendieron equipos en medio, falla.
//  - Rechazar o dejar expirar quita reputación (PENALIZACION_RECHAZO).
//  - Todo se evalúa en el servidor al consultar (procesarTickets), así que los
//    tickets también expiran o se entregan aunque el juego esté cerrado.
const catalogo = require('../config/tickets.catalogo');
const { TICKETS, TEMPERATURA } = require('../config/juego');
const estado = require('./estado.service');
const partida = require('./partida.service');

const num = (valor) => Number(valor || 0);
const NUM_SOLICITANTES = 10; // avatares av1..av10 del cliente (solo estético)

// ----------------------------------------------------------------------
// Funciones puras (se prueban en tests/unit)
// ----------------------------------------------------------------------

const dificultadesDesbloqueadas = (reputacion) =>
  Object.keys(TICKETS.DESBLOQUEO).filter((d) => reputacion >= TICKETS.DESBLOQUEO[d]);

// { nombreProducto: cantidad } + estadísticas reales -> requisitos numéricos
const requisitosDesdeProductos = (requiere, statsPorNombre) => {
  const r = { teraflops: 0, memoria: 0, ancho_banda: 0 };
  for (const [nombre, cantidad] of Object.entries(requiere || {})) {
    const p = statsPorNombre[nombre];
    if (!p) continue;
    r.teraflops += num(p.aumento_teraflops) * cantidad;
    r.memoria += num(p.aumento_memoria) * cantidad;
    r.ancho_banda += num(p.impacto_anchoDeBanda) * cantidad;
  }
  return r;
};

// Plantilla al azar entre las desbloqueadas que no salieron hace poco.
const elegirPlantilla = (reputacion, titulosRecientes = [], aleatorio = Math.random) => {
  const desbloqueadas = new Set(dificultadesDesbloqueadas(reputacion));
  const posibles = catalogo.filter((p) => desbloqueadas.has(p.dificultad));
  const frescas = posibles.filter((p) => !titulosRecientes.includes(p.titulo));
  const lista = frescas.length > 0 ? frescas : posibles;
  return lista[Math.floor(aleatorio() * lista.length)];
};

// Créditos que paga un ticket completado según la temperatura al entregarlo:
// en advertencia (o peor) paga MULTIPLICADOR_TICKETS_ADVERTENCIA de la recompensa.
const pagoPorEntrega = (recompensa, temperatura) => {
  const completo = num(recompensa);
  if (estado.zonaTemperatura(temperatura) === 'OK') return { creditos: completo, recortado: false };
  return {
    creditos: Math.round(completo * TEMPERATURA.MULTIPLICADOR_TICKETS_ADVERTENCIA * 100) / 100,
    recortado: true
  };
};

const alcanza = (capacidad, requerido) =>
  capacidad.teraflops >= requerido.teraflops &&
  capacidad.memoria >= requerido.memoria &&
  capacidad.ancho_banda >= requerido.ancho_banda;

const requisitosDe = (ticket) => ({
  teraflops: num(ticket.teraflops_requeridos),
  memoria: num(ticket.memoriaRequerida),
  ancho_banda: num(ticket.anchoDeBanda_requerido)
});

const parsearRequiere = (valor) => {
  if (!valor) return {};
  if (typeof valor === 'object') return valor;
  try { return JSON.parse(valor); } catch { return {}; }
};

// Forma en la que Godot recibe cada ticket. Los segundos los calcula MySQL con
// su propio reloj, así el cronómetro del cliente no depende de la hora del teléfono.
const formatearTicket = (fila) => ({
  id_ticket: Number(fila.id_ticket),
  titulo: fila.descripcion,
  descripcion: fila.descripcion,
  dificultad: fila.dificultad || null,
  estado: fila.estado,
  solicitante: fila.solicitante === null || fila.solicitante === undefined ? null : Number(fila.solicitante),
  requiere: parsearRequiere(fila.requiere_json),
  teraflops_requeridos: num(fila.teraflops_requeridos),
  memoriaRequerida: num(fila.memoriaRequerida),
  anchoDeBanda_requerido: num(fila.anchoDeBanda_requerido),
  recompensa_creditos: num(fila.recompensa_creditos),
  penalizacion_creditos: num(fila.penalizacion_creditos),
  recompensa_reputacion: num(fila.recompensa_reputacion),
  penalizacion_reputacion: num(fila.penalizacion_reputacion),
  tiempo_proceso_seg: num(fila.tiempo_proceso_seg),
  segundos_para_decidir: fila.estado === 'pendiente' ? Math.max(0, num(fila.segundos_para_decidir)) : null,
  segundos_para_entregar: fila.estado === 'en_proceso' ? Math.max(0, num(fila.segundos_para_entregar)) : null
});

// ----------------------------------------------------------------------
// Base de datos (dentro de una transacción con la fila del usuario bloqueada)
// ----------------------------------------------------------------------

const SELECT_TICKET = `SELECT t.*,
    TIMESTAMPDIFF(SECOND, NOW(), t.fecha_limite) AS segundos_para_decidir,
    TIMESTAMPDIFF(SECOND, NOW(), t.fecha_entrega) AS segundos_para_entregar
  FROM Tickets_Soporte t`;

const registrar = (conn, id_usuario, tipo, descripcion) =>
  conn.query(
    'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
    [id_usuario, tipo, descripcion.slice(0, 255)]
  );

const cargarTicket = async (conn, id_usuario, id_ticket, bloquear = false) => {
  const [filas] = await conn.query(
    `${SELECT_TICKET} WHERE t.id_ticket = ? AND t.id_usuario = ?${bloquear ? ' FOR UPDATE' : ''}`,
    [id_ticket, id_usuario]
  );
  return filas[0] || null;
};

const listarActivos = async (conn, id_usuario) => {
  const [filas] = await conn.query(
    `${SELECT_TICKET} WHERE t.id_usuario = ? AND t.estado IN ('pendiente', 'en_proceso') ORDER BY t.id_ticket`,
    [id_usuario]
  );
  return filas.map(formatearTicket);
};

const listarRecientes = async (conn, id_usuario, limite = 10) => {
  const [filas] = await conn.query(
    `${SELECT_TICKET} WHERE t.id_usuario = ? AND t.estado IN ('completado', 'fallido', 'rechazado', 'expirado')
     ORDER BY COALESCE(t.fecha_resolucion, t.fecha_creacion) DESC, t.id_ticket DESC LIMIT ?`,
    [id_usuario, limite]
  );
  return filas.map(formatearTicket);
};

// Crea UNA solicitud nueva a partir del catálogo.
const generarTicket = async (conn, id_usuario, reputacion) => {
  const [recientes] = await conn.query(
    'SELECT descripcion FROM Tickets_Soporte WHERE id_usuario = ? ORDER BY id_ticket DESC LIMIT ?',
    [id_usuario, TICKETS.NO_REPETIR_ULTIMOS]
  );
  const plantilla = elegirPlantilla(reputacion, recientes.map((r) => r.descripcion));
  if (!plantilla) return null;

  const nombres = Object.keys(plantilla.requiere);
  const [productos] = await conn.query(
    `SELECT nombreProducto, aumento_teraflops, aumento_memoria, impacto_anchoDeBanda
     FROM Catalogo_Productos WHERE nombreProducto IN (?)`,
    [nombres]
  );
  const stats = Object.fromEntries(productos.map((p) => [p.nombreProducto, p]));
  const req = requisitosDesdeProductos(plantilla.requiere, stats);
  const rep = TICKETS.REPUTACION[plantilla.dificultad];

  const [r] = await conn.query(
    `INSERT INTO Tickets_Soporte
       (id_usuario, descripcion, teraflops_requeridos, anchoDeBanda_requerido, memoriaRequerida,
        recompensa_creditos, penalizacion_creditos, recompensa_reputacion, penalizacion_reputacion,
        estado, dificultad, requiere_json, solicitante, fecha_limite, tiempo_proceso_seg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, NOW() + INTERVAL ? SECOND, ?)`,
    [
      id_usuario, plantilla.titulo, req.teraflops, req.ancho_banda, req.memoria,
      plantilla.rc, plantilla.pc, rep.recompensa, rep.penalizacion,
      plantilla.dificultad, JSON.stringify(plantilla.requiere),
      Math.floor(Math.random() * NUM_SOLICITANTES),
      TICKETS.SEGUNDOS_DECISION, TICKETS.SEGUNDOS_PROCESO
    ]
  );
  return r.insertId;
};

// Expira, entrega y genera tickets según el reloj de MySQL. Devuelve la lista
// de eventos ocurridos (para las notificaciones del cliente).
const procesarTickets = async (conn, id_usuario, { generar = true } = {}) => {
  const [usuarios] = await conn.query(
    'SELECT creditos, reputacion, contratos_finalizados, estado_partida FROM Usuarios WHERE id_usuario = ?',
    [id_usuario]
  );
  const u = usuarios[0];
  if (!u || partida.esGameOver(u)) return [];

  const eventos = [];
  let creditos = num(u.creditos);
  let reputacion = num(u.reputacion);
  let contratos = num(u.contratos_finalizados);
  let cambios = false;
  const terminada = () => reputacion <= 0;

  // 1) Solicitudes sin respuesta a tiempo -> EXPIRADO
  const [expirados] = await conn.query(
    `SELECT id_ticket, descripcion FROM Tickets_Soporte
     WHERE id_usuario = ? AND estado = 'pendiente' AND fecha_limite IS NOT NULL AND fecha_limite <= NOW()
     ORDER BY fecha_limite`,
    [id_usuario]
  );
  for (const t of expirados) {
    if (terminada()) break;
    reputacion = partida.clampReputacion(reputacion - TICKETS.PENALIZACION_RECHAZO);
    cambios = true;
    await conn.query(
      "UPDATE Tickets_Soporte SET estado = 'expirado', fecha_resolucion = NOW() WHERE id_ticket = ?",
      [t.id_ticket]
    );
    await registrar(conn, id_usuario, 'TICKET_EXPIRADO', `Dejó expirar: ${t.descripcion} (-${TICKETS.PENALIZACION_RECHAZO} reputación)`);
    eventos.push({ tipo: 'EXPIRADO', id_ticket: Number(t.id_ticket), titulo: t.descripcion, reputacion: -TICKETS.PENALIZACION_RECHAZO, creditos: 0 });
  }

  // 2) Tickets en proceso cuya entrega ya venció -> COMPLETADO o FALLIDO
  const [vencidos] = await conn.query(
    `SELECT * FROM Tickets_Soporte
     WHERE id_usuario = ? AND estado = 'en_proceso' AND fecha_entrega <= NOW()
     ORDER BY fecha_entrega, id_ticket`,
    [id_usuario]
  );
  if (vencidos.length > 0 && !terminada()) {
    const capacidad = estado.calcularMetricas(await estado.cargarInventario(conn, id_usuario));
    const reservas = await estado.cargarReservas(conn, id_usuario);
    for (const t of vencidos) {
      if (terminada()) break;
      const exito = alcanza(capacidad, reservas);
      const req = requisitosDe(t);
      reservas.teraflops -= req.teraflops; // libera lo que apartaba este ticket
      reservas.memoria -= req.memoria;
      reservas.ancho_banda -= req.ancho_banda;

      let deltaCreditos;
      let deltaRep;
      let recortado = false;
      if (exito) {
        const pago = pagoPorEntrega(t.recompensa_creditos, capacidad.temperatura);
        deltaCreditos = pago.creditos;
        recortado = pago.recortado;
        deltaRep = num(t.recompensa_reputacion);
        contratos += 1;
      } else {
        deltaCreditos = -Math.min(creditos, num(t.penalizacion_creditos));
        deltaRep = -num(t.penalizacion_reputacion);
      }
      creditos += deltaCreditos;
      const repAntes = reputacion;
      reputacion = partida.clampReputacion(reputacion + deltaRep);
      cambios = true;

      await conn.query(
        'UPDATE Tickets_Soporte SET estado = ?, fecha_resolucion = NOW() WHERE id_ticket = ?',
        [exito ? 'completado' : 'fallido', t.id_ticket]
      );
      await registrar(
        conn, id_usuario, exito ? 'TICKET_EXITOSO' : 'TICKET_FALLIDO',
        exito
          ? `Completó ticket: ${t.descripcion} (+${deltaCreditos} créditos${recortado ? `, -${Math.round((1 - TEMPERATURA.MULTIPLICADOR_TICKETS_ADVERTENCIA) * 100)}% por sobrecalentamiento` : ''})`
          : `Falló ticket: ${t.descripcion} por falta de capacidad (${deltaCreditos} créditos)`
      );
      const evento = {
        tipo: exito ? 'COMPLETADO' : 'FALLIDO',
        id_ticket: Number(t.id_ticket),
        titulo: t.descripcion,
        creditos: deltaCreditos,
        reputacion: reputacion - repAntes
      };
      if (recortado) {
        evento.recorte_temperatura = true;
        evento.recompensa_completa = num(t.recompensa_creditos);
      }
      eventos.push(evento);
    }
  }

  const estadoPartida = partida.estadoTrasReputacion(reputacion, u.estado_partida);
  if (cambios) {
    await conn.query(
      'UPDATE Usuarios SET creditos = ?, reputacion = ?, contratos_finalizados = ?, estado_partida = ? WHERE id_usuario = ?',
      [creditos, reputacion, contratos, estadoPartida, id_usuario]
    );
  }
  if (estadoPartida === partida.GAME_OVER) {
    eventos.push({ tipo: 'GAME_OVER', id_ticket: null, titulo: null, creditos: 0, reputacion: 0 });
    return eventos;
  }

  // 3) Llegan clientes nuevos: uno por llamada, con intervalo mínimo y tope de activos
  if (generar) {
    const [[conteo]] = await conn.query(
      `SELECT
         SUM(estado IN ('pendiente', 'en_proceso')) AS activos,
         TIMESTAMPDIFF(SECOND, MAX(fecha_creacion), NOW()) AS segundos_desde_ultimo
       FROM Tickets_Soporte WHERE id_usuario = ?`,
      [id_usuario]
    );
    const activos = num(conteo.activos);
    const desdeUltimo = conteo.segundos_desde_ultimo === null ? Infinity : num(conteo.segundos_desde_ultimo);
    if (activos < TICKETS.MAX_ACTIVOS && desdeUltimo >= TICKETS.INTERVALO_SEGUNDOS) {
      const id = await generarTicket(conn, id_usuario, reputacion);
      if (id) eventos.push({ tipo: 'NUEVO', id_ticket: id, titulo: null, creditos: 0, reputacion: 0 });
    }
  }
  return eventos;
};

// Después de un apagado de emergencia: si lo que apartan los tickets en proceso
// ya no cabe en la capacidad encendida, fallan AHORA (del aceptado más reciente
// al más viejo) hasta que lo que queda sí quepa. Misma penalización que un
// ticket fallido al entregarse. Devuelve los eventos FALLIDO (y GAME_OVER).
const fallarPorCapacidad = async (conn, id_usuario, motivo = 'OVERHEATED') => {
  const [usuarios] = await conn.query(
    'SELECT creditos, reputacion, estado_partida FROM Usuarios WHERE id_usuario = ?',
    [id_usuario]
  );
  const u = usuarios[0];
  if (!u || partida.esGameOver(u)) return [];

  const capacidad = estado.calcularMetricas(await estado.cargarInventario(conn, id_usuario));
  const reservas = await estado.cargarReservas(conn, id_usuario);
  if (alcanza(capacidad, reservas)) return [];

  const [enProceso] = await conn.query(
    `SELECT * FROM Tickets_Soporte WHERE id_usuario = ? AND estado = 'en_proceso'
     ORDER BY fecha_aceptado DESC, id_ticket DESC`,
    [id_usuario]
  );
  const eventos = [];
  let creditos = num(u.creditos);
  let reputacion = num(u.reputacion);
  for (const t of enProceso) {
    if (alcanza(capacidad, reservas) || reputacion <= 0) break;
    const req = requisitosDe(t);
    reservas.teraflops -= req.teraflops;
    reservas.memoria -= req.memoria;
    reservas.ancho_banda -= req.ancho_banda;

    const deltaCreditos = -Math.min(creditos, num(t.penalizacion_creditos));
    const repAntes = reputacion;
    creditos += deltaCreditos;
    reputacion = partida.clampReputacion(reputacion - num(t.penalizacion_reputacion));

    await conn.query(
      "UPDATE Tickets_Soporte SET estado = 'fallido', fecha_resolucion = NOW() WHERE id_ticket = ?",
      [t.id_ticket]
    );
    await registrar(
      conn, id_usuario, 'TICKET_FALLIDO',
      `Falló ticket: ${t.descripcion} por apagado de emergencia (${deltaCreditos} créditos)`
    );
    eventos.push({
      tipo: 'FALLIDO',
      motivo,
      id_ticket: Number(t.id_ticket),
      titulo: t.descripcion,
      creditos: deltaCreditos,
      reputacion: reputacion - repAntes
    });
  }

  if (eventos.length > 0) {
    const estadoPartida = partida.estadoTrasReputacion(reputacion, u.estado_partida);
    await conn.query(
      'UPDATE Usuarios SET creditos = ?, reputacion = ?, estado_partida = ? WHERE id_usuario = ?',
      [creditos, reputacion, estadoPartida, id_usuario]
    );
    if (estadoPartida === partida.GAME_OVER) {
      eventos.push({ tipo: 'GAME_OVER', id_ticket: null, titulo: null, creditos: 0, reputacion: 0 });
    }
  }
  return eventos;
};

module.exports = {
  pagoPorEntrega,
  fallarPorCapacidad,
  dificultadesDesbloqueadas,
  requisitosDesdeProductos,
  elegirPlantilla,
  alcanza,
  requisitosDe,
  formatearTicket,
  cargarTicket,
  listarActivos,
  listarRecientes,
  generarTicket,
  procesarTickets
};
