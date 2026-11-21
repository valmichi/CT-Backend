// Estado del jugador para el Dashboard de Godot (CLAUDE.md §6).
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirEstudiante } = require('../middlewares/auth.middleware');
const estado = require('../services/estado.service');

router.use(autenticarToken, requerirEstudiante);

// GET /api/usuario/dashboard -> { estado_partida, metricas, racks }
router.get('/dashboard', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SELECT id_usuario FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [req.usuario.id_usuario]);
    const resultado = await estado.recalcularYGuardar(conn, req.usuario.id_usuario);
    await conn.commit();

    if (!resultado) {
      return res.status(404).json({ error: 'Usuario no encontrado', codigo: 'NOT_FOUND' });
    }
    res.json({ nombreUsuario: resultado.usuario.nombreUsuario, ...resultado.estado });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: 'Error al obtener el dashboard', detalle: error.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
