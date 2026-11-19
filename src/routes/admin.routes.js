const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirDocente } = require('../middlewares/auth.middleware');

// Solo docentes autenticados pueden consultar métricas
router.use(autenticarToken, requerirDocente);

// Obtener todas las métricas de alumnos para el dashboard
router.get('/metricas-alumnos', async (req, res) => {
  try {
    // Solo alumnos de las clases del docente autenticado
    const [alumnos] = await db.query(
      `SELECT u.id_usuario, u.nombreUsuario, c.codigo_clase, u.creditos, u.reputacion,
              u.teraflopsCD, u.temperaturaCD, u.carga_electrica_actual, u.capacidad_watts,
              u.contratos_finalizados, u.ataquesResueltos
       FROM Usuarios u
       JOIN Clases c ON u.id_clase = c.id_clase
       WHERE c.id_profesor = ?
       ORDER BY u.reputacion DESC`,
      [req.usuario.id_profesor]
    );
    res.json(alumnos);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar métricas', detalle: error.message });
  }
});

module.exports = router;
