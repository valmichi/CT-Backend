const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirProfesor } = require('../middlewares/auth.middleware');
const crypto = require('crypto');

// Función auxiliar para generar código CT-XXXXX
const generarCodigoClase = () => {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluye caracteres ambiguos (0, O, 1, I)
  let codigo = '';
  for (let i = 0; i < 5; i++) {
    const randomByte = crypto.randomBytes(1)[0];
    codigo += caracteres[randomByte % caracteres.length];
  }
  return `CT-${codigo}`;
};

// Todas las rutas de este archivo requieren sesión de Profesor activa
router.use(autenticarToken, requerirProfesor);

// POST /api/profesor/clases (Crear clase y generar código único)
router.post('/', async (req, res) => {
  const { nombre_clase } = req.body;
  const id_profesor = req.usuario.id_profesor;

  if (!nombre_clase) {
    return res.status(400).json({ error: 'El nombre de la clase es requerido' });
  }

  try {
    let codigoGenerado = '';
    let codigoUnico = false;

    // Asegurar unicidad del código en la base de datos
    while (!codigoUnico) {
      codigoGenerado = generarCodigoClase();
      const [existente] = await db.query('SELECT id_clase FROM Clases WHERE codigo_clase = ?', [codigoGenerado]);
      if (existente.length === 0) {
        codigoUnico = true;
      }
    }

    const [result] = await db.query(
      'INSERT INTO Clases (id_profesor, nombre_clase, codigo_clase) VALUES (?, ?, ?)',
      [id_profesor, nombre_clase, codigoGenerado]
    );

    res.status(201).json({
      mensaje: 'Clase creada exitosamente',
      clase: {
        id_clase: result.insertId,
        nombre_clase,
        codigo_clase: codigoGenerado,
        activa: 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear la clase', detalle: error.message });
  }
});

// GET /api/profesor/clases (Listar solo las clases del profesor autenticado)
router.get('/', async (req, res) => {
  const id_profesor = req.usuario.id_profesor;

  try {
    const [clases] = await db.query(
      `SELECT c.id_clase, c.nombre_clase, c.codigo_clase, c.activa, c.fecha_creacion,
              COUNT(u.id_usuario) AS total_alumnos
       FROM Clases c
       LEFT JOIN Usuarios u ON c.id_clase = u.id_clase
       WHERE c.id_profesor = ?
       GROUP BY c.id_clase
       ORDER BY c.fecha_creacion DESC`,
      [id_profesor]
    );

    res.json(clases);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener clases', detalle: error.message });
  }
});

// GET /api/profesor/clases/:id/alumnos (Alumnos de una clase validando pertenencia)
router.get('/:id/alumnos', async (req, res) => {
  const id_clase = req.params.id;
  const id_profesor = req.usuario.id_profesor;

  try {
    // 1. Validar que la clase le pertenece al profesor
    const [clase] = await db.query('SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?', [id_clase, id_profesor]);
    if (clase.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso a esta clase o no existe' });
    }

    // 2. Obtener lista de alumnos con sus métricas
    const [alumnos] = await db.query(
      `SELECT id_usuario, nombreUsuario, creditos, reputacion, teraflopsCD,
              temperaturaCD, carga_electrica_actual, capacidad_watts,
              contratos_finalizados, ataquesResueltos
       FROM Usuarios
       WHERE id_clase = ?
       ORDER BY reputacion DESC`,
      [id_clase]
    );

    res.json(alumnos);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar alumnos de la clase', detalle: error.message });
  }
});

module.exports = router;
