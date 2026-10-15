const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken } = require('../middlewares/auth.middleware');

router.use(autenticarToken);

// Catálogo de incidentes predefinidos del simulador
const CATALOGO_INCIDENTES = [
  {
    tipo: 'SOBRECALENTAMIENTO',
    descripcion: 'Alerta térmica: Los sensores del Rack 1 superaron el umbral crítico.',
    accion_requerida: 'ACTIVAR_REFRIGERACION_EMERGENCIA',
    penalizacion_creditos: 150.0,
    penalizacion_reputacion: 20,
    recompensa_creditos: 100.0,
    recompensa_reputacion: 15
  },
  {
    tipo: 'ATAQUE_SEGURIDAD',
    descripcion: 'Intento de fuerza bruta detectado en el puerto SSH / Firewall.',
    accion_requerida: 'BLOQUEAR_IPS_FIREWALL',
    penalizacion_creditos: 200.0,
    penalizacion_reputacion: 25,
    recompensa_creditos: 150.0,
    recompensa_reputacion: 20
  },
  {
    tipo: 'SATURACION_RED',
    descripcion: 'Tráfico anómalo provocando cuello de botella en los switches core.',
    accion_requerida: 'BALANCEAR_CARGA_QOS',
    penalizacion_creditos: 120.0,
    penalizacion_reputacion: 15,
    recompensa_creditos: 80.0,
    recompensa_reputacion: 10
  }
];

// Generar incidente aleatorio para el jugador
router.post('/generar', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;

  try {
    // Verificar si ya tiene un incidente activo sin resolver
    const [activos] = await db.query(
      'SELECT id_incidente FROM Incidentes_Activos WHERE id_usuario = ? AND estado = "activo"',
      [id_usuario]
    );

    if (activos.length > 0) {
      return res.status(400).json({ error: 'Ya existe un incidente activo pendiente de atención' });
    }

    // Elegir aleatoriamente entre los 3 tipos
    const inc = CATALOGO_INCIDENTES[Math.floor(Math.random() * CATALOGO_INCIDENTES.length)];

    const [result] = await db.query(
      `INSERT INTO Incidentes_Activos
       (id_usuario, tipo, descripcion, accion_requerida, penalizacion_creditos, penalizacion_reputacion, recompensa_creditos, recompensa_reputacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_usuario, inc.tipo, inc.descripcion, inc.accion_requerida,
        inc.penalizacion_creditos, inc.penalizacion_reputacion,
        inc.recompensa_creditos, inc.recompensa_reputacion
      ]
    );

    res.status(201).json({
      mensaje: '¡Incidente generado en el Data Center!',
      incidente: {
        id_incidente: result.insertId,
        tipo: inc.tipo,
        descripcion: inc.descripcion,
        // No enviamos accion_requerida para que el cliente no haga trampa; el servidor valida la respuesta
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error generando incidente', detalle: error.message });
  }
});

// Consultar incidentes activos del alumno
router.get('/activos', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const [incidentes] = await db.query(
      'SELECT id_incidente, tipo, descripcion, fecha_creacion FROM Incidentes_Activos WHERE id_usuario = ? AND estado = "activo"',
      [id_usuario]
    );
    res.json(incidentes);
  } catch (error) {
    res.status(500).json({ error: 'Error al consultar incidentes', detalle: error.message });
  }
});

// Resolver incidente
router.post('/resolver', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const { id_incidente, accion_ejecutada } = req.body;

  if (!id_incidente || !accion_ejecutada) {
    return res.status(400).json({ error: 'id_incidente y accion_ejecutada son requeridos' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [incidentes] = await connection.query(
      'SELECT * FROM Incidentes_Activos WHERE id_incidente = ? AND id_usuario = ? FOR UPDATE',
      [id_incidente, id_usuario]
    );

    if (incidentes.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Incidente no encontrado o ajeno al usuario' });
    }

    const inc = incidentes[0];
    if (inc.estado !== 'activo') {
      await connection.rollback();
      return res.status(400).json({ error: 'El incidente ya fue concluido previamente' });
    }

    const [users] = await connection.query('SELECT * FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [id_usuario]);
    const user = users[0];

    const esCorrecto = (inc.accion_requerida === accion_ejecutada);
    let resultado = {};

    if (esCorrecto) {
      const nuevosCreditos = user.creditos + inc.recompensa_creditos;
      const nuevaReputacion = user.reputacion + inc.recompensa_reputacion;
      const nuevosAtaques = (inc.tipo === 'ATAQUE_SEGURIDAD') ? (user.ataquesResueltos + 1) : user.ataquesResueltos;

      await connection.query(
        'UPDATE Usuarios SET creditos = ?, reputacion = ?, ataquesResueltos = ? WHERE id_usuario = ?',
        [nuevosCreditos, nuevaReputacion, nuevosAtaques, id_usuario]
      );
      await connection.query('UPDATE Incidentes_Activos SET estado = "resuelto" WHERE id_incidente = ?', [id_incidente]);

      await connection.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'INCIDENTE_RESUELTO', `Mitigó ${inc.tipo} con ${accion_ejecutada}`]
      );

      resultado = {
        exito: true,
        mensaje: '¡Incidente mitigado exitosamente por el administrador!',
        creditosActuales: nuevosCreditos,
        reputacionActual: nuevaReputacion
      };
    } else {
      const nuevosCreditos = Math.max(0, user.creditos - inc.penalizacion_creditos);
      const nuevaReputacion = Math.max(0, user.reputacion - inc.penalizacion_reputacion);

      await connection.query(
        'UPDATE Usuarios SET creditos = ?, reputacion = ? WHERE id_usuario = ?',
        [nuevosCreditos, nuevaReputacion, id_usuario]
      );
      await connection.query('UPDATE Incidentes_Activos SET estado = "fallido" WHERE id_incidente = ?', [id_incidente]);

      await connection.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'INCIDENTE_FALLIDO', `Acción errónea ante ${inc.tipo} (${accion_ejecutada})`]
      );

      resultado = {
        exito: false,
        mensaje: 'Acción incorrecta. El incidente dañó la reputación y causó pérdidas.',
        creditosActuales: nuevosCreditos,
        reputacionActual: nuevaReputacion
      };
    }

    await connection.commit();
    res.json(resultado);
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Error resolviendo incidente', detalle: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
