// Incidentes del Data Center. La lógica vive en services/incidentes.service.js;
// el servidor también los genera solo desde GET /api/usuario/dashboard.
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirEstudiante } = require('../middlewares/auth.middleware');
const partida = require('../services/partida.service');
const estado = require('../services/estado.service');
const incidentes = require('../services/incidentes.service');
const catalogo = require('../config/incidentes.catalogo');

router.use(autenticarToken, requerirEstudiante);

const idValido = (valor) => {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Transacción con la fila del usuario bloqueada; `trabajo` devuelve { status, body }.
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

// POST /api/eventos/generar { tipo? } -> fuerza un incidente ahora (pruebas / profesor).
// En el juego normal llegan solos cada 2-4 minutos.
router.post('/generar', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const { tipo } = req.body || {};
  if (tipo !== undefined && !catalogo.INCIDENTES.some((i) => i.tipo === tipo)) {
    return res.status(400).json({ error: 'Tipo de incidente desconocido' });
  }
  try {
    const r = await enTransaccion(id_usuario, async (conn, usuario) => {
      if (partida.esGameOver(usuario)) return partida.respuestaGameOver();
      if (await incidentes.cargarActivo(conn, id_usuario)) {
        return { status: 400, body: { error: 'Ya existe un incidente activo pendiente de atención' } };
      }
      const g = await incidentes.generarIncidente(conn, id_usuario, tipo || null);
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);
      return {
        status: 201,
        body: {
          mensaje: '¡Incidente generado en el Data Center!',
          incidente: incidentes.formatearIncidente(g.fila),
          eventos: g.eventos,
          estado: resultado.estado
        }
      };
    });
    res.status(r.status).json(r.body);
  } catch (error) {
    res.status(500).json({ error: 'Error generando incidente', detalle: error.message });
  }
});

// GET /api/eventos/activos -> [incidente] (0 o 1), con opciones y segundos restantes
router.get('/activos', async (req, res) => {
  try {
    const activo = await incidentes.cargarActivo(db, req.usuario.id_usuario);
    res.json(activo ? [incidentes.formatearIncidente(activo)] : []);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar incidentes', detalle: error.message });
  }
});

// POST /api/eventos/resolver { id_incidente, accion_ejecutada }
router.post('/resolver', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const { id_incidente, accion_ejecutada } = req.body || {};
  const id = idValido(id_incidente);
  if (!id || !accion_ejecutada || typeof accion_ejecutada !== 'string') {
    return res.status(400).json({ error: 'id_incidente y accion_ejecutada son requeridos' });
  }

  try {
    const r = await enTransaccion(id_usuario, async (conn, usuario) => {
      const inc = await incidentes.cargarIncidente(conn, id_usuario, id);
      if (!inc) return { status: 404, body: { error: 'Incidente no encontrado o ajeno al usuario' } };
      if (inc.estado !== 'activo') {
        return { status: 400, body: { error: 'El incidente ya fue concluido previamente', codigo: 'ALREADY_PROCESSED' } };
      }
      if (partida.esGameOver(usuario)) return partida.respuestaGameOver();

      // Se acabó el tiempo: cuenta como no atendido aunque la acción fuera correcta.
      const vencido = inc.segundos_restantes !== null && Number(inc.segundos_restantes) <= 0;
      const exito = !vencido && inc.accion_requerida === accion_ejecutada;
      const cierre = await incidentes.cerrarIncidente(conn, id_usuario, inc, exito, vencido ? 'EXPIRADO' : 'ACCION_INCORRECTA');
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);

      let mensaje = '¡Incidente mitigado exitosamente!';
      if (vencido) mensaje = 'Se acabó el tiempo para responder. El incidente causó pérdidas.';
      else if (!exito) mensaje = 'Acción incorrecta. El incidente dañó la reputación y causó pérdidas.';
      if (inc.tipo === 'FALLA_ELECTRICA') mensaje += ' La energía se restableció: vuelve a encender los equipos apagados.';

      return {
        status: 200,
        body: {
          exito,
          mensaje,
          creditosActuales: cierre.creditos,
          reputacionActual: cierre.reputacion,
          estado_partida: cierre.estado_partida,
          eventos: [cierre.evento],
          estado: resultado.estado
        }
      };
    });
    res.status(r.status).json(r.body);
  } catch (error) {
    res.status(500).json({ error: 'Error resolviendo incidente', detalle: error.message });
  }
});

module.exports = router;
