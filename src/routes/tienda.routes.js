const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken, requerirEstudiante } = require('../middlewares/auth.middleware');
const estado = require('../services/estado.service');
const partida = require('../services/partida.service');

// El catálogo es público para consulta
router.get('/catalogo', async (req, res) => {
  try {
    const [catalogo] = await db.query('SELECT * FROM Catalogo_Productos');
    res.json(catalogo);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener catálogo', detalle: error.message });
  }
});

// Comprar hardware (Protegido con JWT)
router.post('/comprar', autenticarToken, requerirEstudiante, async (req, res) => {
  const id_usuario = req.usuario.id_usuario; // Extraído de forma segura del JWT
  const { id_producto } = req.body;

  if (!id_producto) {
    return res.status(400).json({ error: 'id_producto es requerido' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT * FROM Usuarios WHERE id_usuario = ? FOR UPDATE', [id_usuario]);
    const [prods] = await connection.query('SELECT * FROM Catalogo_Productos WHERE id_producto = ?', [id_producto]);

    if (users.length === 0 || prods.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Usuario o producto no encontrado' });
    }

    const user = users[0];
    const prod = prods[0];

    if (partida.esGameOver(user)) {
      await connection.rollback();
      const r = partida.respuestaGameOver();
      return res.status(r.status).json(r.body);
    }

    // mysql2 entrega DECIMAL como texto: convertir antes de comparar.
    const creditosUser = Number(user.creditos);
    const costoProd = Number(prod.costo);

    // Validaciones del simulador
    if (creditosUser < costoProd) {
      await connection.rollback();
      return res.status(400).json({ error: 'Créditos insuficientes', codigo: 'INSUFFICIENT_CREDITS' });
    }

    // Espacio: debe existir un hueco CONTIGUO en algún rack (un equipo no se parte).
    const items = await estado.asegurarUbicaciones(
      connection,
      await estado.cargarInventario(connection, id_usuario)
    );
    const hueco = estado.buscarHueco(items, Number(prod.espacioNecesario));
    if (!hueco) {
      await connection.rollback();
      return res.status(400).json({ error: 'Espacio físico insuficiente en el rack', codigo: 'INSUFFICIENT_SPACE' });
    }

    // Energía: si no alcanza, se compra e instala pero queda APAGADO (CLAUDE.md §5).
    const actual = estado.calcularMetricas(items);
    const encendido =
      actual.carga_electrica + Number(prod.consumoElectrico) <=
      actual.capacidad_watts + Number(prod.aumento_watts);

    const nuevosCreditos = creditosUser - costoProd;
    await connection.query('UPDATE Usuarios SET creditos = ? WHERE id_usuario = ?', [nuevosCreditos, id_usuario]);

    const [insercion] = await connection.query(
      `INSERT INTO Inventario_Usuario (id_usuario, id_producto, encendido, rack_numero, slot_inicio)
       VALUES (?, ?, ?, ?, ?)`,
      [id_usuario, id_producto, encendido, hueco.rack_numero, hueco.slot_inicio]
    );

    await connection.query(
      'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
      [id_usuario, 'COMPRA', `Compró ${prod.nombreProducto} por $${costoProd}${encendido ? '' : ' (apagado: energía insuficiente)'}`]
    );

    const resultado = await estado.recalcularYGuardar(connection, id_usuario);
    await connection.commit();

    const m = resultado.estado.metricas;
    res.json({
      mensaje: encendido
        ? 'Compra realizada con éxito'
        : 'Compra realizada. El equipo quedó APAGADO: no hay energía suficiente para encenderlo.',
      aviso: encendido ? null : 'INSUFFICIENT_POWER',
      id_inventario: insercion.insertId,
      ubicacion: hueco,
      encendido,
      // Formato anterior, se conserva por compatibilidad con clientes viejos/pruebas
      metricasActualizadas: {
        creditos: m.creditos,
        espacioFisicoDisponible: m.espacio_total - m.espacio_usado,
        teraflopsCD: m.teraflops,
        temperaturaCD: m.temperatura,
        memoriaDisponibleCD: m.memoria,
        ancho_bandaCD: m.ancho_banda,
        carga_electrica_actual: m.carga_electrica,
        capacidad_watts: m.capacidad_watts
      },
      estado: resultado.estado
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Error al procesar la compra', detalle: error.message });
  } finally {
    connection.release();
  }
});

// Obtener inventario del usuario (Protegido con JWT)
router.get('/inventario', autenticarToken, requerirEstudiante, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const [inventario] = await db.query(
      `SELECT i.*, p.* FROM Inventario_Usuario i 
       JOIN Catalogo_Productos p ON i.id_producto = p.id_producto 
       WHERE i.id_usuario = ?`,
      [id_usuario]
    );
    res.json(inventario);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener inventario', detalle: error.message });
  }
});

module.exports = router;