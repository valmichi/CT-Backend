// Ingresos pasivos (CLAUDE.md §5 "Temperatura (3 Rangos)").
//
// Los servidores encendidos generan créditos por minuto según sus TFLOPS. No se
// cobra con un temporizador: cada vez que el jugador consulta o cambia su
// estado se cobra lo generado desde Usuarios.ultimo_cobro (reloj de MySQL).
//
// IMPORTANTE: hay que cobrar ANTES de cualquier cambio de equipo (comprar,
// encender/apagar, vender), para que el tramo anterior se pague con la tasa y la
// temperatura que había en ese momento. Debe llamarse dentro de una transacción
// con la fila del usuario bloqueada (FOR UPDATE).
const { INGRESOS } = require('../config/juego');
const estado = require('./estado.service');

const SIN_COBRO = Object.freeze({ monto: 0, segundos: 0 });

const cobrarIngresos = async (conn, id_usuario) => {
  const [filas] = await conn.query(
    `SELECT estado_partida, ultimo_cobro IS NULL AS sin_cobro,
            TIMESTAMPDIFF(SECOND, ultimo_cobro, NOW()) AS segundos
     FROM Usuarios WHERE id_usuario = ?`,
    [id_usuario]
  );
  const u = filas[0];
  if (!u) return SIN_COBRO;

  // Con la partida terminada no se genera dinero; solo se mueve el reloj para
  // que al reiniciar no se cobre el tiempo que pasó en GAME_OVER.
  if (u.estado_partida === 'GAME_OVER' || Number(u.sin_cobro)) {
    await conn.query('UPDATE Usuarios SET ultimo_cobro = NOW() WHERE id_usuario = ?', [id_usuario]);
    return SIN_COBRO;
  }

  const ingresos = estado.calcularIngresos(await estado.cargarInventario(conn, id_usuario));
  const cobro = estado.calcularCobro(u.segundos, ingresos.ingreso_por_minuto);

  if (cobro.excedido) {
    // Más tiempo que el tope: se paga el tope y el resto se pierde.
    await conn.query(
      'UPDATE Usuarios SET creditos = creditos + ?, ultimo_cobro = NOW() WHERE id_usuario = ?',
      [cobro.monto, id_usuario]
    );
  } else if (cobro.segundos > 0) {
    // Se avanza exactamente lo cobrado para no perder fracciones de segundo.
    await conn.query(
      'UPDATE Usuarios SET creditos = creditos + ?, ultimo_cobro = ultimo_cobro + INTERVAL ? SECOND WHERE id_usuario = ?',
      [cobro.monto, cobro.segundos, id_usuario]
    );
  }

  // Solo cobros grandes van a la bitácora (si no, uno cada 5 s del dashboard).
  if (cobro.monto > 0 && cobro.segundos >= INGRESOS.SEGUNDOS_AVISO) {
    await conn.query(
      'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
      [id_usuario, 'INGRESO_PASIVO', `Ingresos pasivos: +${cobro.monto} créditos en ${Math.round(cobro.segundos / 60)} min`]
    );
  }

  return { monto: cobro.monto, segundos: cobro.segundos, ingreso_por_minuto: ingresos.ingreso_por_minuto, status: ingresos.status };
};

// Evento para las notificaciones de Godot cuando se cobró un rato largo de golpe
// (p. ej. al volver a abrir el juego). null si no hay nada que avisar.
const eventoIngreso = (cobro) =>
  (cobro.monto > 0 && cobro.segundos >= INGRESOS.SEGUNDOS_AVISO
    ? { tipo: 'INGRESO_PASIVO', id_ticket: null, titulo: null, creditos: cobro.monto, reputacion: 0, segundos: cobro.segundos }
    : null);

module.exports = { cobrarIngresos, eventoIngreso };
