const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken } = require('../middlewares/auth.middleware');

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
router.post('/comprar', autenticarToken, async (req, res) => {
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

    // --- CONVERSIÓN A NÚMEROS (Evita errores de comparación de String en JS) ---
    const creditosUser = Number(user.creditos);
    const costoProd = Number(prod.costo);
    const espacioUser = Number(user.espacioFisicoDisponible);
    const espacioProd = Number(prod.espacioNecesario);

    // Validaciones del simulador
    if (creditosUser < costoProd) {
      await connection.rollback();
      return res.status(400).json({ error: 'Créditos insuficientes' });
    }
    if (espacioUser < espacioProd) {
      await connection.rollback();
      return res.status(400).json({ error: 'Espacio físico insuficiente en el rack' });
    }

    // Recálculo de recursos en el servidor
    const nuevosCreditos = creditosUser - costoProd;
    const nuevoEspacio = espacioUser - espacioProd;
    const nuevosTeraflops = Number(user.teraflopsCD) + Number(prod.aumento_teraflops || 0);
    const nuevaTemp = Math.max(18, Number(user.temperaturaCD) + Number(prod.impacto_temperatura || 0));
    const nuevaMemoria = Number(user.memoriaDisponibleCD) + Number(prod.aumento_memoria || 0);
    const nuevoAnchoBanda = Number(user.ancho_bandaCD) + Number(prod.impacto_anchoDeBanda || 0);
    const nuevaCargaElectrica = Number(user.carga_electrica_actual) + Number(prod.consumoElectrico || 0);
    const nuevaCapacidadWatts = Number(user.capacidad_watts) + Number(prod.aumento_watts || 0);

    await connection.query(
      `UPDATE Usuarios SET
        creditos = ?, espacioFisicoDisponible = ?, teraflopsCD = ?,
        temperaturaCD = ?, memoriaDisponibleCD = ?, ancho_bandaCD = ?,
        carga_electrica_actual = ?, capacidad_watts = ?
       WHERE id_usuario = ?`,
      [
        nuevosCreditos, nuevoEspacio, nuevosTeraflops, nuevaTemp,
        nuevaMemoria, nuevoAnchoBanda, nuevaCargaElectrica, nuevaCapacidadWatts,
        id_usuario
      ]
    );

    await connection.query(
      'INSERT INTO Inventario_Usuario (id_usuario, id_producto) VALUES (?, ?)',
      [id_usuario, id_producto]
    );

    // Registro opcional en bitácora de actividad
    await connection.query(
      'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
      [id_usuario, 'COMPRA', `Compró ${prod.nombreProducto} por $${costoProd}`]
    );

    await connection.commit();

    res.json({
      mensaje: 'Compra realizada con éxito',
      metricasActualizadas: {
        creditos: nuevosCreditos,
        espacioFisicoDisponible: nuevoEspacio,
        teraflopsCD: nuevosTeraflops,
        temperaturaCD: nuevaTemp,
        memoriaDisponibleCD: nuevaMemoria,
        ancho_bandaCD: nuevoAnchoBanda,
        carga_electrica_actual: nuevaCargaElectrica,
        capacidad_watts: nuevaCapacidadWatts
      }
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Error al procesar la compra', detalle: error.message });
  } finally {
    connection.release();
  }
});

// Obtener inventario del usuario (Protegido con JWT)
router.get('/inventario', autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  try {
    const [inventario] = await db.query(
      `SELECT i.*, p.* FROM inventario_usuario i 
       JOIN catalogo_productos p ON i.id_producto = p.id_producto 
       WHERE i.id_usuario = ?`,
      [id_usuario]
    );
    res.json(inventario);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener inventario', detalle: error.message });
  }
});

module.exports = router;