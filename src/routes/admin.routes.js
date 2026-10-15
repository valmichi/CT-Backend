const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Obtener todas las métricas de alumnos para el dashboard
router.get('/metricas-alumnos', async (req, res) => {
  try {
    const [alumnos] = await db.query(
      `SELECT id_usuario, nombreUsuario, codigo_clase, creditos, reputacion,
              teraflopsCD, temperaturaCD, carga_electrica_actual, capacidad_watts,
              contratos_finalizados, ataquesResueltos
       FROM Usuarios
       ORDER BY reputacion DESC`
    );
    res.json(alumnos);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar métricas', detalle: error.message });
  }
});

module.exports = router;
