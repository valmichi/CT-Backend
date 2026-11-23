// Tickets de soporte (solicitudes de clientes). La lógica del ciclo de vida vive
// en services/tickets.service.js; aquí solo se validan entradas y se arman
// las transacciones con la fila del usuario bloqueada (FOR UPDATE).
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirEstudiante } = require('../middlewares/auth.middleware');
const partida = require('../services/partida.service');
const estado = require('../services/estado.service');
const tickets = require('../services/tickets.service');
const ingresos = require('../services/ingresos.service');
const { TICKETS } = require('../config/juego');

// Todas las rutas de tickets son del jugador
router.use(autenticarToken, requerirEstudiante);

const idValido = (valor) => {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Corre `trabajo(conn, usuario)` en una transacción con el usuario bloqueado.
// `trabajo` devuelve { status, body }; con status >= 400 se hace rollback.
const enTransaccion = async (id_usuario, trabajo) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query('SELECT * FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [id_usuario]);
    if (users.length === 0) {
      await conn.rollback();
      return { status: 404, body: { error: 'Usuario no encontrado', codigo: 'NOT_FOUND' } };
    }
    const r = await trabajo(conn, users[0]);
    if (r.status >= 400) await conn.rollback();
    else await conn.commit();
    return r;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

const responder = (res, r) => res.status(r.status).json(r.body);

// ----------------------------------------------------------------------
// GET /api/tickets -> procesa (expira/entrega/genera) y devuelve el tablero
//   { activos: [...], recientes: [...], eventos: [...], estado: {...} }
// Es lo que consulta periódicamente la pantalla de Tickets en Godot.
// ----------------------------------------------------------------------
router.get('/', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const r = await enTransaccion(id_usuario, async (conn) => {
      const cobro = await ingresos.cobrarIngresos(conn, id_usuario);
      const eventos = await tickets.procesarTickets(conn, id_usuario);
      const evIngreso = ingresos.eventoIngreso(cobro);
      if (evIngreso) eventos.unshift(evIngreso);
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);
      return {
        status: 200,
        body: {
          activos: await tickets.listarActivos(conn, id_usuario),
          recientes: await tickets.listarRecientes(conn, id_usuario),
          eventos,
          estado: resultado.estado
        }
      };
    });
    responder(res, r);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tickets', detalle: error.message });
  }
});

// ----------------------------------------------------------------------
// POST /api/tickets/:id/aceptar -> aparta capacidad y arranca el tiempo de entrega
// ----------------------------------------------------------------------
router.post('/:id/aceptar', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const id_ticket = idValido(req.params.id);
  if (!id_ticket) return res.status(400).json({ error: 'id de ticket inválido' });

  try {
    const r = await enTransaccion(id_usuario, async (conn, usuario) => {
      if (partida.esGameOver(usuario)) return partida.respuestaGameOver();
      await tickets.procesarTickets(conn, id_usuario, { generar: false }); // puede expirarlo

      const t = await tickets.cargarTicket(conn, id_usuario, id_ticket, true);
      if (!t) return { status: 404, body: { error: 'Ticket no encontrado para este jugador', codigo: 'NOT_FOUND' } };
      if (t.estado === 'expirado') {
        return { status: 409, body: { error: 'El ticket expiró antes de aceptarlo', codigo: 'EXPIRED' } };
      }
      if (t.estado !== 'pendiente') {
        return { status: 409, body: { error: 'El ticket ya fue procesado', codigo: 'ALREADY_PROCESSED' } };
      }

      const capacidad = estado.calcularMetricas(await estado.cargarInventario(conn, id_usuario));
      const libre = estado.capacidadLibre(capacidad, await estado.cargarReservas(conn, id_usuario));
      const req = tickets.requisitosDe(t);
      if (!tickets.alcanza(libre, req)) {
        const faltan = [];
        if (libre.teraflops < req.teraflops) faltan.push(`${req.teraflops - libre.teraflops} TFLOPS`);
        if (libre.memoria < req.memoria) faltan.push(`${req.memoria - libre.memoria} GB de RAM`);
        if (libre.ancho_banda < req.ancho_banda) faltan.push(`${req.ancho_banda - libre.ancho_banda} de ancho de banda`);
        return {
          status: 409,
          body: {
            error: `Capacidad libre insuficiente: faltan ${faltan.join(', ')}. Rechaza el ticket o mejora tu equipo.`,
            codigo: 'INSUFFICIENT_RESOURCES',
            requerido: req,
            libre
          }
        };
      }

      await conn.query(
        `UPDATE Tickets_Soporte SET estado = 'en_proceso', fecha_aceptado = NOW(),
           fecha_entrega = NOW() + INTERVAL tiempo_proceso_seg SECOND
         WHERE id_ticket = ?`,
        [id_ticket]
      );
      await conn.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'TICKET_ACEPTADO', `Aceptó ticket: ${t.descripcion}`.slice(0, 255)]
      );
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);
      const actualizado = await tickets.cargarTicket(conn, id_usuario, id_ticket);
      return {
        status: 200,
        body: { mensaje: 'Ticket aceptado: capacidad reservada', ticket: tickets.formatearTicket(actualizado), estado: resultado.estado }
      };
    });
    responder(res, r);
  } catch (error) {
    res.status(500).json({ error: 'Error al aceptar el ticket', detalle: error.message });
  }
});

// ----------------------------------------------------------------------
// POST /api/tickets/:id/rechazar -> quita reputación (CLAUDE.md §4)
// ----------------------------------------------------------------------
router.post('/:id/rechazar', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const id_ticket = idValido(req.params.id);
  if (!id_ticket) return res.status(400).json({ error: 'id de ticket inválido' });

  try {
    const r = await enTransaccion(id_usuario, async (conn, usuario) => {
      if (partida.esGameOver(usuario)) return partida.respuestaGameOver();
      await tickets.procesarTickets(conn, id_usuario, { generar: false });

      const t = await tickets.cargarTicket(conn, id_usuario, id_ticket, true);
      if (!t) return { status: 404, body: { error: 'Ticket no encontrado para este jugador', codigo: 'NOT_FOUND' } };
      if (t.estado !== 'pendiente') {
        return { status: 409, body: { error: 'Solo se pueden rechazar solicitudes pendientes', codigo: 'ALREADY_PROCESSED' } };
      }

      // Releer la reputación: procesarTickets pudo cambiarla (p. ej. otro expiró)
      const [[u]] = await conn.query('SELECT reputacion, estado_partida FROM Usuarios WHERE id_usuario = ?', [id_usuario]);
      if (partida.esGameOver(u)) return partida.respuestaGameOver();
      const reputacion = partida.clampReputacion(Number(u.reputacion) - TICKETS.PENALIZACION_RECHAZO);
      const estadoPartida = partida.estadoTrasReputacion(reputacion, u.estado_partida);

      await conn.query("UPDATE Tickets_Soporte SET estado = 'rechazado', fecha_resolucion = NOW() WHERE id_ticket = ?", [id_ticket]);
      await conn.query('UPDATE Usuarios SET reputacion = ?, estado_partida = ? WHERE id_usuario = ?', [reputacion, estadoPartida, id_usuario]);
      await conn.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'TICKET_RECHAZADO', `Rechazó ticket: ${t.descripcion} (-${TICKETS.PENALIZACION_RECHAZO} reputación)`.slice(0, 255)]
      );
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);
      return {
        status: 200,
        body: {
          mensaje: `Ticket rechazado (-${TICKETS.PENALIZACION_RECHAZO} de reputación)`,
          reputacionActual: reputacion,
          estado_partida: estadoPartida,
          estado: resultado.estado
        }
      };
    });
    responder(res, r);
  } catch (error) {
    res.status(500).json({ error: 'Error al rechazar el ticket', detalle: error.message });
  }
});

// ----------------------------------------------------------------------
// Rutas anteriores (compatibilidad)
// ----------------------------------------------------------------------

// Tickets demo fijos (pruebas). Ya traen fecha límite y tiempo de proceso.
router.post('/generar-demo', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    if (await partida.partidaTerminada(db, id_usuario)) return responder(res, partida.respuestaGameOver());
    const ticketsDemo = [
      ['Hospedaje Web PYME', 12, 50, 8, 150.0, 50.0, 10, 15],
      ['Procesamiento IA / ML', 30, 200, 32, 450.0, 150.0, 25, 30],
      ['Servidor Streaming Video', 20, 350, 16, 300.0, 100.0, 15, 20]
    ];
    for (const t of ticketsDemo) {
      await db.query(
        `INSERT INTO Tickets_Soporte
         (id_usuario, descripcion, teraflops_requeridos, anchoDeBanda_requerido, memoriaRequerida,
          recompensa_creditos, penalizacion_creditos, recompensa_reputacion, penalizacion_reputacion,
          estado, fecha_limite, tiempo_proceso_seg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', NOW() + INTERVAL ? SECOND, ?)`,
        [id_usuario, ...t, TICKETS.SEGUNDOS_DECISION, TICKETS.SEGUNDOS_PROCESO]
      );
    }
    res.json({ mensaje: 'Tickets demo asignados exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error generando tickets demo', detalle: error.message });
  }
});

// Solo los pendientes (sin procesar ni generar). La pantalla nueva usa GET /api/tickets.
router.get('/pendientes', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const [filas] = await db.query(
      "SELECT * FROM Tickets_Soporte WHERE id_usuario = ? AND estado = 'pendiente' ORDER BY id_ticket",
      [id_usuario]
    );
    res.json(filas);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tickets', detalle: error.message });
  }
});

// POST /api/tickets/resolver { id_ticket } -> pide la entrega de un ticket EN PROCESO
// cuyo tiempo ya terminó. (Antes resolvía cualquier pendiente al instante; ahora
// hay que aceptarlo primero y esperar el tiempo de entrega.)
router.post('/resolver', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const id_ticket = idValido((req.body || {}).id_ticket);
  if (!id_ticket) return res.status(400).json({ error: 'id_ticket es requerido' });

  try {
    const r = await enTransaccion(id_usuario, async (conn, usuario) => {
      const t = await tickets.cargarTicket(conn, id_usuario, id_ticket, true);
      if (!t) return { status: 404, body: { error: 'Usuario o ticket no encontrado para este jugador' } };
      if (partida.esGameOver(usuario)) return partida.respuestaGameOver();
      if (t.estado === 'pendiente') {
        return { status: 409, body: { error: 'Primero acepta el ticket', codigo: 'NOT_ACCEPTED' } };
      }
      if (t.estado !== 'en_proceso') {
        return { status: 400, body: { error: 'El ticket ya fue completado o descartado' } };
      }
      if (Number(t.segundos_para_entregar) > 0) {
        return {
          status: 409,
          body: { error: `Faltan ${t.segundos_para_entregar} s para la entrega`, codigo: 'NOT_READY', segundos_para_entregar: Number(t.segundos_para_entregar) }
        };
      }

      const eventos = await tickets.procesarTickets(conn, id_usuario, { generar: false });
      const ev = eventos.find((e) => e.id_ticket === id_ticket);
      const [[u]] = await conn.query('SELECT creditos, reputacion, estado_partida FROM Usuarios WHERE id_usuario = ?', [id_usuario]);
      const exito = Boolean(ev) && ev.tipo === 'COMPLETADO';
      return {
        status: 200,
        body: {
          exito,
          mensaje: exito ? '¡Ticket completado con éxito!' : 'Capacidad insuficiente en el Data Center. Penalización aplicada.',
          creditosActuales: Number(u.creditos),
          reputacionActual: Number(u.reputacion),
          estado_partida: u.estado_partida
        }
      };
    });
    responder(res, r);
  } catch (error) {
    res.status(500).json({ error: 'Error procesando ticket', detalle: error.message });
  }
});

module.exports = router;
