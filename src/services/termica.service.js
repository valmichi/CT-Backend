// Zona crítica de temperatura (CLAUDE.md §5): APAGADO DE EMERGENCIA.
//
// Si el Data Center pasa de TEMPERATURA.CRITICA (85 °C), el servidor apaga
// equipos del que más calor genera al que menos hasta volver a <= 85 °C
// (estado.planApagadoEmergencia), los marca con motivo_apagado = 'OVERHEATED'
// y hace fallar en ese momento los tickets en proceso que se quedaron sin
// capacidad. No hay castigo extra: se pierden sus ingresos y esos tickets.
//
// Se llama DESPUÉS de cualquier cambio que pueda calentar (comprar, encender,
// apagar o vender refrigeración) y en dashboard / GET /api/tickets (por si una
// partida vieja quedó arriba de 85 °C). Siempre dentro de la transacción con la
// fila del usuario bloqueada y ANTES de estado.recalcularYGuardar().
const estado = require('./estado.service');
const tickets = require('./tickets.service');
const partida = require('./partida.service');

const OVERHEATED = 'OVERHEATED';

// Devuelve los eventos para el cliente: [] si no hizo falta apagar nada, o
// [APAGADO_EMERGENCIA, ...FALLIDO, (GAME_OVER)].
const protegerTemperatura = async (conn, id_usuario) => {
  const [usuarios] = await conn.query('SELECT estado_partida FROM Usuarios WHERE id_usuario = ?', [id_usuario]);
  if (!usuarios[0] || partida.esGameOver(usuarios[0])) return [];

  const items = await estado.cargarInventario(conn, id_usuario);
  const ids = estado.planApagadoEmergencia(items);
  if (ids.length === 0) return [];

  const temperaturaAntes = estado.calcularMetricas(items).temperatura;
  await conn.query(
    'UPDATE Inventario_Usuario SET encendido = FALSE, motivo_apagado = ? WHERE id_usuario = ? AND id_inventario IN (?)',
    [OVERHEATED, id_usuario, ids]
  );
  const apagados = items.filter((i) => ids.includes(i.id_inventario));
  for (const item of apagados) item.encendido = false;
  const temperaturaDespues = estado.calcularMetricas(items).temperatura;

  const nombres = apagados.map((i) => i.nombreProducto).join(', ');
  await conn.query(
    'INSERT INTO Historial_Actividad (id_usuario, tipo_evento, descripcion) VALUES (?, ?, ?)',
    [id_usuario, 'APAGADO_EMERGENCIA', `Apagado de emergencia a ${temperaturaAntes} °C: ${nombres}`.slice(0, 255)]
  );

  const evento = {
    tipo: 'APAGADO_EMERGENCIA',
    id_ticket: null,
    titulo: null,
    creditos: 0,
    reputacion: 0,
    temperatura_antes: temperaturaAntes,
    temperatura_despues: temperaturaDespues,
    equipos: apagados.map((i) => ({ id_inventario: i.id_inventario, nombreProducto: i.nombreProducto }))
  };
  const fallidos = await tickets.fallarPorCapacidad(conn, id_usuario, OVERHEATED);
  return [evento, ...fallidos];
};

module.exports = { OVERHEATED, protegerTemperatura };
