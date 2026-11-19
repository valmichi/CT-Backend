const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { autenticarToken } = require('../middlewares/auth.middleware');

router.get('/estado', autenticarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;

  try {
    const [usuarios] = await db.query('SELECT * FROM Usuarios WHERE id_usuario = ?', [id_usuario]);
    if (usuarios.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const [inventario] = await db.query(
      `SELECT iu.id_inventario, iu.fecha_compra, cp.nombreProducto, cp.categoria,
              cp.aumento_teraflops, cp.impacto_temperatura, cp.consumoElectrico
       FROM Inventario_Usuario iu
       JOIN Catalogo_Productos cp ON iu.id_producto = cp.id_producto
       WHERE iu.id_usuario = ?`,
      [id_usuario]
    );

    res.json({
      usuario: usuarios[0],
      inventario
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener estado del jugador', detalle: error.message });
  }
});

module.exports = router;
