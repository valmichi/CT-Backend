const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken } = require('../middlewares/auth.middleware');

// Generar tickets demo asignados al alumno autenticado
router.post('/generar-demo', autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const ticketsDemo = [
      ['Hospedaje Web PYME', 12, 50, 8, 150.0, 50.0, 10, 15],
      ['Procesamiento IA / ML', 30, 200, 32, 450.0, 150.0, 25, 30],
      ['Servidor Streaming Video', 20, 350, 16, 300.0, 100.0, 15, 20]
    ];

    for (const t of ticketsDemo) {
      await db.query(
        `INSERT INTO Tickets_Soporte
         (id_usuario, descripcion, teraflops_requeridos, anchoDeBanda_requerido, memoriaRequerida,
          recompensa_creditos, penalizacion_creditos, recompensa_reputacion, penalizacion_reputacion, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`,
        [id_usuario, ...t]
      );
    }

    res.json({ mensaje: 'Tickets demo asignados exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error generando tickets demo', detalle: error.message });
  }
});

// Listar tickets pendientes del alumno
router.get('/pendientes', autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const [tickets] = await db.query(
      'SELECT * FROM Tickets_Soporte WHERE id_usuario = ? AND estado = "pendiente"',
      [id_usuario]
    );
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener tickets', detalle: error.message });
  }
});

// Resolver contrato
router.post('/resolver', autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const { id_ticket } = req.body;

  if (!id_ticket) {
    return res.status(400).json({ error: 'id_ticket es requerido' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT * FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [id_usuario]);
    const [tickets] = await connection.query(
      'SELECT * FROM Tickets_Soporte WHERE id_ticket = ? AND id_usuario = ? FOR UPDATE',
      [id_ticket, id_usuario]
    );

    if (users.length === 0 || tickets.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Usuario o ticket no encontrado para este jugador' });
    }

    const user = users[0];
    const ticket = tickets[0];

    if (ticket.estado !== 'pendiente') {
      await connection.rollback();
      return res.status(400).json({ error: 'El ticket ya fue completado o descartado' });
    }

    const cumple =
      user.teraflopsCD >= ticket.teraflops_requeridos &&
      user.ancho_bandaCD >= ticket.anchoDeBanda_requerido &&
      user.memoriaDisponibleCD >= ticket.memoriaRequerida;

    let resultado = {};

    if (cumple) {
      const nuevosCreditos = user.creditos + ticket.recompensa_creditos;
      const nuevaReputacion = user.reputacion + ticket.recompensa_reputacion;
      const finalizados = user.contratos_finalizados + 1;

      await connection.query(
        'UPDATE Usuarios SET creditos = ?, reputacion = ?, contratos_finalizados = ? WHERE id_usuario = ?',
        [nuevosCreditos, nuevaReputacion, finalizados, id_usuario]
      );
      await connection.query('UPDATE Tickets_Soporte SET estado = "completado" WHERE id_ticket = ?', [id_ticket]);

      await connection.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'TICKET_EXITOSO', `Completó ticket: ${ticket.descripcion} (+${ticket.recompensa_creditos} créditos)`]
      );

      resultado = {
        exito: true,
        mensaje: '¡Ticket completado con éxito!',
        creditosActuales: nuevosCreditos,
        reputacionActual: nuevaReputacion
      };
    } else {
      const nuevosCreditos = Math.max(0, user.creditos - ticket.penalizacion_creditos);
      const nuevaReputacion = Math.max(0, user.reputacion - ticket.penalizacion_reputacion);

      await connection.query(
        'UPDATE Usuarios SET creditos = ?, reputacion = ? WHERE id_usuario = ?',
        [nuevosCreditos, nuevaReputacion, id_usuario]
      );
      await connection.query('UPDATE Tickets_Soporte SET estado = "fallido" WHERE id_ticket = ?', [id_ticket]);

      await connection.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'TICKET_FALLIDO', `Falló ticket: ${ticket.descripcion} (-${ticket.penalizacion_creditos} créditos)`]
      );

      resultado = {
        exito: false,
        mensaje: 'Capacidad insuficiente en el Data Center. Penalización aplicada.',
        creditosActuales: nuevosCreditos,
        reputacionActual: nuevaReputacion
      };
    }

    await connection.commit();
    res.json(resultado);
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Error procesando ticket', detalle: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
