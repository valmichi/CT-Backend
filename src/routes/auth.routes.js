const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// ======================================================================
// LOGIN DE ESTUDIANTE (Acceso al Simulador Cyber Tycoon)
// Requiere: nombreUsuario y codigo_clase
// Restricción: El alumno debe haber sido dado de alta previamente por el docente
// ======================================================================
router.post('/login', async (req, res) => {
  try {
    const { nombreUsuario, codigo_clase } = req.body;

    // 1. Validar campos requeridos
    if (!nombreUsuario || !codigo_clase) {
      return res.status(400).json({
        error: 'El nombre de usuario y el código de clase son obligatorios.'
      });
    }

    const usuarioLimpio = nombreUsuario.trim();
    const codigoLimpio = codigo_clase.trim().toUpperCase();

    // 2. Validar existencia y estado de la clase
    const [clases] = await db.query(
      'SELECT id_clase, activa FROM Clases WHERE codigo_clase = ?',
      [codigoLimpio]
    );

    if (clases.length === 0) {
      return res.status(404).json({
        error: 'El código de clase no existe. Verifica con tu profesor.'
      });
    }

    if (!clases[0].activa) {
      return res.status(403).json({
        error: 'Esta clase se encuentra inactiva en este momento.'
      });
    }

    const id_clase = clases[0].id_clase;

    // 3. Verificar que el estudiante haya sido pre-registrado por el docente
    const [usuarios] = await db.query(
      `SELECT
        id_usuario,
        id_clase,
        nombreUsuario,
        rol,
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
       WHERE nombreUsuario = ? AND id_clase = ?`,
      [usuarioLimpio, id_clase]
    );

    if (usuarios.length === 0) {
      return res.status(403).json({
        error: 'Estudiante no registrado en esta clase. Solicita a tu profesor que te dé de alta en el panel.'
      });
    }

    const usuario = usuarios[0];

    // 4. Firmar el token JWT (vigencia de 8 horas para jornada de laboratorio)
    const token = jwt.sign(
      {
        id_usuario: usuario.id_usuario,
        id_clase: usuario.id_clase,
        nombreUsuario: usuario.nombreUsuario,
        rol: usuario.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    // 5. Registrar evento de auditoría en la base de datos
    await db.query(
      `INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion)
       VALUES (?, 'LOGIN', 'Inicio de sesión exitoso en el simulador')`,
      [usuario.id_usuario]
    );

    // 6. Responder al cliente (Godot) con el token y el estado del Data Center
    res.json({
      mensaje: 'Acceso autorizado al simulador',
      token,
      usuario: {
        id_usuario: usuario.id_usuario,
        id_clase: usuario.id_clase,
        nombreUsuario: usuario.nombreUsuario,
        creditos: Number(usuario.creditos),
        reputacion: usuario.reputacion,
        teraflopsCD: usuario.teraflopsCD,
        temperaturaCD: usuario.temperaturaCD,
        memoriaDisponibleCD: usuario.memoriaDisponibleCD,
        ancho_bandaCD: usuario.ancho_bandaCD,
        carga_electrica_actual: usuario.carga_electrica_actual,
        capacidad_watts: usuario.capacidad_watts,
        espacioFisicoDisponible: usuario.espacioFisicoDisponible,
        contratos_finalizados: usuario.contratos_finalizados,
        ataquesResueltos: usuario.ataquesResueltos
      }
    });

  } catch (error) {
    console.error('Error en /auth/login de estudiante:', error);
    res.status(500).json({ error: 'Error interno en el servidor de autenticación.' });
  }
});

module.exports = router;
