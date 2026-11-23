// Estado del jugador para el Dashboard de Godot (CLAUDE.md §6).
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirEstudiante } = require('../middlewares/auth.middleware');
const estado = require('../services/estado.service');
const partida = require('../services/partida.service');
const tickets = require('../services/tickets.service');
const ingresos = require('../services/ingresos.service');

router.use(autenticarToken, requerirEstudiante);

// GET /api/usuario/dashboard -> { estado_partida, metricas, racks }
router.get('/dashboard', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id_usuario FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [req.usuario.id_usuario]);
    // Expira / entrega tickets y deja llegar clientes nuevos aunque la pantalla
    // de Tickets esté cerrada (o el juego haya estado cerrado un rato).
    // Primero se paga lo que generaron los servidores desde la última consulta.
    const cobro = await ingresos.cobrarIngresos(conn, req.usuario.id_usuario);
    const eventos = await tickets.procesarTickets(conn, req.usuario.id_usuario);
    const evIngreso = ingresos.eventoIngreso(cobro);
    if (evIngreso) eventos.unshift(evIngreso);
    const resultado = await estado.recalcularYGuardar(conn, req.usuario.id_usuario);
    await conn.commit();

    if (!resultado) {
      return res.status(404).json({ error: 'Usuario no encontrado', codigo: 'NOT_FOUND' });
    }
    const [[conteo]] = await db.query(
      `SELECT COALESCE(SUM(estado = 'pendiente'), 0) AS pendientes, COALESCE(SUM(estado = 'en_proceso'), 0) AS en_proceso
       FROM Tickets_Soporte WHERE id_usuario = ?`,
      [req.usuario.id_usuario]
    );
    res.json({
      nombreUsuario: resultado.usuario.nombreUsuario,
      ...resultado.estado,
      // Para el globo de avisos del botón de Tickets en el Dashboard
      tickets: { pendientes: Number(conteo.pendientes), en_proceso: Number(conteo.en_proceso) },
      eventos
    });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: 'Error al obtener el dashboard', detalle: error.message });
  } finally {
    conn.release();
  }
});

// POST /api/usuario/reset -> borra equipos, tickets e incidentes y vuelve a los
// valores iniciales (1000 créditos, 50 de reputación, ACTIVE). Se usa desde el
// modal de Game Over, pero también se permite durante una partida activa.
router.post('/reset', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query('SELECT id_usuario FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [req.usuario.id_usuario]);
    if (users.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Usuario no encontrado', codigo: 'NOT_FOUND' });
    }
    const resultado = await partida.reiniciarPartida(conn, req.usuario.id_usuario);
    await conn.commit();
    res.json({ mensaje: 'Partida reiniciada', ...resultado.estado });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: 'Error al reiniciar la partida', detalle: error.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
