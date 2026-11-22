// Inventario del jugador: listar, encender/apagar y vender equipos.
// Todas las operaciones que cambian estado corren en una transacción con la
// fila del usuario bloqueada (FOR UPDATE) para evitar dobles clics.
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirEstudiante } = require('../middlewares/auth.middleware');
const estado = require('../services/estado.service');
const partida = require('../services/partida.service');

router.use(autenticarToken, requerirEstudiante);

const idValido = (valor) => {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Ejecuta `trabajo(conn)` dentro de una transacción con el usuario bloqueado.
// `trabajo` devuelve { status, body } y puede lanzar errores (se hace rollback).
const enTransaccion = async (id_usuario, trabajo) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query('SELECT id_usuario, estado_partida FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [id_usuario]);
    if (users.length === 0) {
      await conn.rollback();
      return { status: 404, body: { error: 'Usuario no encontrado', codigo: 'NOT_FOUND' } };
    }
    if (partida.esGameOver(users[0])) {
      await conn.rollback();
      return partida.respuestaGameOver();
    }
    const resultado = await trabajo(conn);
    if (resultado.status >= 400) await conn.rollback();
    else await conn.commit();
    return resultado;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
};

// GET /api/inventario  -> equipos del jugador con su estado y precio de venta
router.get('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    const items = await estado.asegurarUbicaciones(conn, await estado.cargarInventario(conn, req.usuario.id_usuario));
    res.json(items.map((item) => ({ ...item, precio_venta: estado.precioVenta(item.costo) })));
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener inventario', detalle: error.message });
  } finally {
    conn.release();
  }
});

// POST /api/inventario/:id/estado  { encendido: true|false }
router.post('/:id/estado', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const id_inventario = idValido(req.params.id);
  const { encendido } = req.body || {};

  if (!id_inventario || typeof encendido !== 'boolean') {
    return res.status(400).json({ error: 'Se requiere un id de inventario válido y "encendido" (true/false)' });
  }

  try {
    const r = await enTransaccion(id_usuario, async (conn) => {
      const items = await estado.cargarInventario(conn, id_usuario);
      const item = items.find((i) => i.id_inventario === id_inventario);
      if (!item) {
        return { status: 404, body: { error: 'Equipo no encontrado en tu inventario', codigo: 'NOT_FOUND' } };
      }
      if (item.encendido === encendido) {
        return {
          status: 409,
          body: { error: `El equipo ya estaba ${encendido ? 'encendido' : 'apagado'}`, codigo: 'ALREADY_PROCESSED' }
        };
      }

      const m = estado.calcularMetricas(items);
      if (encendido && m.carga_electrica + item.consumoElectrico > m.capacidad_watts + item.aumento_watts) {
        return {
          status: 409,
          body: {
            error: `Energía insuficiente: consumo ${m.carga_electrica} W + ${item.consumoElectrico} W supera la capacidad de ${m.capacidad_watts} W`,
            codigo: 'INSUFFICIENT_POWER'
          }
        };
      }
      if (!encendido && item.aumento_watts > 0 &&
          m.carga_electrica - item.consumoElectrico > m.capacidad_watts - item.aumento_watts) {
        return {
          status: 409,
          body: { error: 'Esta unidad de energía alimenta equipos encendidos. Apaga servidores primero.', codigo: 'POWER_IN_USE' }
        };
      }

      await conn.query('UPDATE Inventario_Usuario SET encendido = ? WHERE id_inventario = ?', [encendido, id_inventario]);
      await conn.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, encendido ? 'EQUIPO_ENCENDIDO' : 'EQUIPO_APAGADO', `${encendido ? 'Encendió' : 'Apagó'} ${item.nombreProducto}`]
      );
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);
      return {
        status: 200,
        body: {
          mensaje: `${item.nombreProducto} ${encendido ? 'encendido' : 'apagado'}`,
          id_inventario,
          encendido,
          estado: resultado.estado
        }
      };
    });
    res.status(r.status).json(r.body);
  } catch (error) {
    res.status(500).json({ error: 'Error al cambiar el estado del equipo', detalle: error.message });
  }
});

// POST /api/inventario/:id/vender  -> devuelve PORCENTAJE_REEMBOLSO del costo
router.post('/:id/vender', async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const id_inventario = idValido(req.params.id);
  if (!id_inventario) {
    return res.status(400).json({ error: 'Se requiere un id de inventario válido' });
  }

  try {
    const r = await enTransaccion(id_usuario, async (conn) => {
      const items = await estado.cargarInventario(conn, id_usuario);
      const item = items.find((i) => i.id_inventario === id_inventario);
      if (!item) {
        // Con el usuario bloqueado, un segundo clic llega aquí cuando el primero ya vendió.
        return { status: 409, body: { error: 'El equipo no existe o ya fue vendido', codigo: 'ALREADY_PROCESSED' } };
      }

      const m = estado.calcularMetricas(items);
      if (item.encendido && item.aumento_watts > 0 &&
          m.carga_electrica - item.consumoElectrico > m.capacidad_watts - item.aumento_watts) {
        return {
          status: 409,
          body: { error: 'No puedes vender esta unidad de energía: dejaría sin luz a equipos encendidos. Apaga servidores primero.', codigo: 'POWER_IN_USE' }
        };
      }

      const reembolso = estado.precioVenta(item.costo);
      await conn.query('DELETE FROM Inventario_Usuario WHERE id_inventario = ?', [id_inventario]);
      await conn.query('UPDATE Usuarios SET creditos = creditos + ? WHERE id_usuario = ?', [reembolso, id_usuario]);
      await conn.query(
        'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
        [id_usuario, 'VENTA', `Vendió ${item.nombreProducto} por $${reembolso}`]
      );
      const resultado = await estado.recalcularYGuardar(conn, id_usuario);
      return {
        status: 200,
        body: { mensaje: `Vendiste ${item.nombreProducto} por $${reembolso}`, id_inventario, reembolso, estado: resultado.estado }
      };
    });
    res.status(r.status).json(r.body);
  } catch (error) {
    res.status(500).json({ error: 'Error al vender el equipo', detalle: error.message });
  }
});

module.exports = router;
