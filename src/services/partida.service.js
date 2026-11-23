// Reglas de reputación y fin de partida (CLAUDE.md §5 "Reputación en Cero").
//  - La reputación siempre queda en [REPUTACION_MIN, REPUTACION_MAX].
//  - Si llega a 0, la cuenta pasa a GAME_OVER y se bloquean las acciones
//    operativas (comprar, encender/apagar, vender, tickets, incidentes).
//  - POST /api/usuario/reset devuelve la partida a los valores iniciales.
const {
  REPUTACION_MIN,
  REPUTACION_MAX,
  REPUTACION_INICIAL,
  CREDITOS_INICIALES
} = require('../config/juego');
const estado = require('./estado.service');

const ACTIVE = 'ACTIVE';
const GAME_OVER = 'GAME_OVER';

const clampReputacion = (valor) =>
  Math.min(REPUTACION_MAX, Math.max(REPUTACION_MIN, Math.round(Number(valor) || 0)));

// Una vez en GAME_OVER solo el reinicio lo saca de ahí.
const estadoTrasReputacion = (reputacion, estadoActual = ACTIVE) =>
  (reputacion <= REPUTACION_MIN || estadoActual === GAME_OVER ? GAME_OVER : ACTIVE);

const esGameOver = (usuario) => Boolean(usuario) && usuario.estado_partida === GAME_OVER;

// Respuesta estándar cuando se intenta jugar con la partida terminada.
const respuestaGameOver = () => ({
  status: 409,
  body: {
    error: 'Partida terminada: tu reputación llegó a 0. Reinicia la partida para seguir jugando.',
    codigo: GAME_OVER,
    estado_partida: GAME_OVER
  }
});

// Para rutas sin transacción (generar tickets/incidentes): consulta simple.
const partidaTerminada = async (conn, id_usuario) => {
  const [filas] = await conn.query('SELECT estado_partida FROM Usuarios WHERE id_usuario = ?', [id_usuario]);
  return esGameOver(filas[0]);
};

// Debe llamarse dentro de una transacción con la fila del usuario bloqueada.
const reiniciarPartida = async (conn, id_usuario) => {
  await conn.query('DELETE FROM Inventario_Usuario WHERE id_usuario = ?', [id_usuario]);
  await conn.query('DELETE FROM Tickets_Soporte WHERE id_usuario = ?', [id_usuario]);
  await conn.query('DELETE FROM Incidentes_Activos WHERE id_usuario = ?', [id_usuario]);
  await conn.query(
    `UPDATE Usuarios SET creditos = ?, reputacion = ?, contratos_finalizados = 0,
       ataquesResueltos = 0, estado_partida = ?, ultimo_cobro = NOW()
     WHERE id_usuario = ?`,
    [CREDITOS_INICIALES, REPUTACION_INICIAL, ACTIVE, id_usuario]
  );
  // El historial NO se borra: es la bitácora que audita el docente.
  await conn.query(
    'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
    [id_usuario, 'REINICIO', 'Reinició la partida desde cero']
  );
  // Recalcula la caché de métricas (sin equipos = valores base).
  return estado.recalcularYGuardar(conn, id_usuario);
};

module.exports = {
  ACTIVE,
  GAME_OVER,
  clampReputacion,
  estadoTrasReputacion,
  esGameOver,
  respuestaGameOver,
  partidaTerminada,
  reiniciarPartida
};
