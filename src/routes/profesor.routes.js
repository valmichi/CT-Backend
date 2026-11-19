const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// ======================================================================
// MIDDLEWARE DE AUTORIZACIÓN: Solo Docentes / Administradores
// ======================================================================
const verificarTokenDocente = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado: Token de autenticación requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    if (decoded.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso restringido: Se requieren privilegios de docente' });
    }
    req.profesor = decoded;
    next();
  });
};

// ======================================================================
// 1. REGISTRO DE NUEVO PROFESOR (Protegido por Clave Maestra)
// ======================================================================
router.post('/registro', async (req, res) => {
  try {
    const { nombre, correo, password, clave_maestra } = req.body;

    if (!nombre || !correo || !password || !clave_maestra) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Validación de la clave maestra institucional definida en el .env
    if (clave_maestra !== process.env.ADMIN_REGISTRATION_KEY) {
      return res.status(403).json({
        error: 'Acceso no autorizado: La clave maestra institucional es incorrecta'
      });
    }

    // Verificar si el correo ya está registrado
    const [existente] = await db.query(
      'SELECT id_profesor FROM Profesores WHERE correo = ?',
      [correo.trim()]
    );

    if (existente.length > 0) {
      return res.status(400).json({ error: 'Ya existe una cuenta docente con este correo' });
    }

    // Encriptar contraseña con Bcrypt (10 rondas de salt)
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const [resultado] = await db.query(
      'INSERT INTO Profesores (nombre, correo, password_hash) VALUES (?, ?, ?)',
      [nombre.trim(), correo.trim(), password_hash]
    );

    res.status(201).json({
      mensaje: 'Docente registrado exitosamente',
      id_profesor: resultado.insertId
    });
  } catch (error) {
    console.error('Error en /registro docente:', error);
    res.status(500).json({ error: 'Error interno en el servidor al registrar docente' });
  }
});

// ======================================================================
// 2. LOGIN DE PROFESOR
// ======================================================================
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({ error: 'Correo y contraseña requeridos' });
    }

    const [profesores] = await db.query(
      'SELECT * FROM Profesores WHERE correo = ?',
      [correo.trim()]
    );

    if (profesores.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const profesor = profesores[0];
    const passwordValido = await bcrypt.compare(password, profesor.password_hash);

    if (!passwordValido) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Generar JWT administrativo
    const token = jwt.sign(
      {
        id_profesor: profesor.id_profesor,
        nombre: profesor.nombre,
        correo: profesor.correo,
        rol: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      mensaje: 'Autenticación exitosa',
      token,
      profesor: {
        id_profesor: profesor.id_profesor,
        nombre: profesor.nombre,
        correo: profesor.correo
      }
    });
  } catch (error) {
    console.error('Error en /login docente:', error);
    res.status(500).json({ error: 'Error interno en el servidor al iniciar sesión' });
  }
});

// ======================================================================
// 3. OBTENER CLASES DEL PROFESOR
// ======================================================================
router.get('/clases', verificarTokenDocente, async (req, res) => {
  try {
    const id_profesor = req.profesor.id_profesor;

    const [clases] = await db.query(
      'SELECT id_clase, nombre_clase, codigo_clase, activa, fecha_creacion FROM Clases WHERE id_profesor = ? ORDER BY fecha_creacion DESC',
      [id_profesor]
    );

    res.json(clases);
  } catch (error) {
    console.error('Error en GET /clases:', error);
    res.status(500).json({ error: 'Error al obtener las clases' });
  }
});

// ======================================================================
// 4. CREAR NUEVA CLASE (Genera código CT-XXXXX)
// ======================================================================
router.post('/clases', verificarTokenDocente, async (req, res) => {
  try {
    const { nombre_clase } = req.body;
    const id_profesor = req.profesor.id_profesor;

    if (!nombre_clase || nombre_clase.trim() === '') {
      return res.status(400).json({ error: 'El nombre de la clase es requerido' });
    }

    // Generar sufijo alfanumérico aleatorio de 5 caracteres
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigoAleatorio = '';
    for (let i = 0; i < 5; i++) {
      codigoAleatorio += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    const codigo_clase = `CT-${codigoAleatorio}`;

    const [resultado] = await db.query(
      'INSERT INTO Clases (id_profesor, nombre_clase, codigo_clase, activa) VALUES (?, ?, ?, 1)',
      [id_profesor, nombre_clase.trim(), codigo_clase]
    );

    res.status(201).json({
      mensaje: 'Clase creada exitosamente',
      id_clase: resultado.insertId,
      nombre_clase: nombre_clase.trim(),
      codigo_clase
    });
  } catch (error) {
    console.error('Error en POST /clases:', error);
    res.status(500).json({ error: 'Error al generar la clase' });
  }
});

// ======================================================================
// 5. ELIMINAR CLASE COMPLETA (Y alumnos asociados en cascada)
// ======================================================================
router.delete('/clases/:id_clase', verificarTokenDocente, async (req, res) => {
  try {
    const { id_clase } = req.params;
    const id_profesor = req.profesor.id_profesor;

    // Validar que la clase pertenezca al profesor autenticado
    const [clases] = await db.query(
      'SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?',
      [id_clase, id_profesor]
    );

    if (clases.length === 0) {
      return res.status(403).json({ error: 'No tienes autorización para eliminar esta clase o no existe' });
    }

    await db.query('DELETE FROM Clases WHERE id_clase = ?', [id_clase]);

    res.json({ mensaje: 'Clase y estudiantes asociados eliminados con éxito' });
  } catch (error) {
    console.error('Error en DELETE /clases/:id_clase:', error);
    res.status(500).json({ error: 'Error en el servidor al eliminar la clase' });
  }
});

// ======================================================================
// 6. CREAR UN ESTUDIANTE MANUALMENTE DENTRO DE UNA CLASE
// ======================================================================
router.post('/clases/:id_clase/estudiantes', verificarTokenDocente, async (req, res) => {
  try {
    const { id_clase } = req.params;
    const { nombreUsuario } = req.body;
    const id_profesor = req.profesor.id_profesor;

    if (!nombreUsuario || nombreUsuario.trim() === '') {
      return res.status(400).json({ error: 'El nombre o alias del estudiante es obligatorio' });
    }

    // Validar pertenencia de la clase
    const [clases] = await db.query(
      'SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?',
      [id_clase, id_profesor]
    );

    if (clases.length === 0) {
      return res.status(403).json({ error: 'No tienes permisos sobre esta clase' });
    }

    // Verificar que el alias no esté duplicado en esta clase
    const [existente] = await db.query(
      'SELECT id_usuario FROM Usuarios WHERE nombreUsuario = ? AND id_clase = ?',
      [nombreUsuario.trim(), id_clase]
    );

    if (existente.length > 0) {
      return res.status(400).json({ error: 'Ya existe un estudiante con este alias en la clase' });
    }

    // Crear alumno con métricas de inicio de fábrica
    const [resultado] = await db.query(
      `INSERT INTO Usuarios
        (id_clase, nombreUsuario, creditos, reputacion, teraflopsCD, temperaturaCD, memoriaDisponibleCD, ancho_bandaCD, carga_electrica_actual, capacidad_watts, espacioFisicoDisponible)
       VALUES (?, ?, 1000.00, 50, 10, 35, 16, 100, 250, 1000, 42)`,
      [id_clase, nombreUsuario.trim()]
    );

    res.status(201).json({
      mensaje: 'Estudiante dado de alta exitosamente',
      id_usuario: resultado.insertId,
      nombreUsuario: nombreUsuario.trim()
    });
  } catch (error) {
    console.error('Error en POST /clases/:id_clase/estudiantes:', error);
    res.status(500).json({ error: 'Error en el servidor al crear el estudiante' });
  }
});

// ======================================================================
// 7. CONSULTAR MÉTRICAS EN VIVO DE LOS ALUMNOS DE UNA CLASE
// ======================================================================
router.get('/clases/:id_clase/alumnos', verificarTokenDocente, async (req, res) => {
  try {
    const { id_clase } = req.params;
    const id_profesor = req.profesor.id_profesor;

    // Verificar pertenencia de la clase
    const [clases] = await db.query(
      'SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?',
      [id_clase, id_profesor]
    );

    if (clases.length === 0) {
      return res.status(403).json({ error: 'Acceso no autorizado a esta clase' });
    }

    const [alumnos] = await db.query(
      `SELECT
        id_usuario,
        nombreUsuario,
        creditos,
        reputacion,
        teraflopsCD,
        temperaturaCD,
        memoriaDisponibleCD,
        ancho_bandaCD,
        carga_electrica_actual,
        capacidad_watts,
        espacioFisicoDisponible,
        contratos_finalizados,
        ataquesResueltos
       FROM Usuarios
       WHERE id_clase = ?
       ORDER BY reputacion DESC, creditos DESC`,
      [id_clase]
    );

    res.json(alumnos);
  } catch (error) {
    console.error('Error en GET /clases/:id_clase/alumnos:', error);
    res.status(500).json({ error: 'Error al consultar las métricas de los estudiantes' });
  }
});

// ======================================================================
// 8. ELIMINAR A UN ESTUDIANTE ESPECÍFICO
// ======================================================================
router.delete('/estudiantes/:id_usuario', verificarTokenDocente, async (req, res) => {
  try {
    const { id_usuario } = req.params;
    const id_profesor = req.profesor.id_profesor;

    // Verificar que el alumno pertenezca a una clase del profesor logueado
    const [usuario] = await db.query(
      `SELECT u.id_usuario
       FROM Usuarios u
       INNER JOIN Clases c ON u.id_clase = c.id_clase
       WHERE u.id_usuario = ? AND c.id_profesor = ?`,
      [id_usuario, id_profesor]
    );

    if (usuario.length === 0) {
      return res.status(403).json({ error: 'No tienes autorización para eliminar este estudiante' });
    }

    await db.query('DELETE FROM Usuarios WHERE id_usuario = ?', [id_usuario]);

    res.json({ mensaje: 'Estudiante eliminado con éxito' });
  } catch (error) {
    console.error('Error en DELETE /estudiantes/:id_usuario:', error);
    res.status(500).json({ error: 'Error en el servidor al eliminar estudiante' });
  }
});

module.exports = router;
