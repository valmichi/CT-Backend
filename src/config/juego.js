// Constantes de balance del simulador. Un solo lugar para ajustarlas.

// Valores de fábrica del Data Center vacío (deben coincidir con los DEFAULT de
// la tabla Usuarios en init.sql y con el alta de alumnos en profesor.routes.js).
const BASE = Object.freeze({
  teraflops: 10,
  temperatura: 35,
  memoria: 16,
  ancho_banda: 100,
  carga_electrica: 250, // consumo fijo del edificio (iluminación, monitoreo...)
  capacidad_watts: 1000
});

// La temperatura nunca baja de la del ambiente aunque sobre refrigeración.
const TEMPERATURA_MINIMA = 18;

// Espacio físico: NUM_RACKS gabinetes de U_POR_RACK unidades cada uno.
// 3 x 14 = 42 U, igual que Usuarios.espacioFisicoDisponible DEFAULT 42.
const NUM_RACKS = 3;
const U_POR_RACK = 14;
const ESPACIO_TOTAL = NUM_RACKS * U_POR_RACK;

// Porcentaje del costo que se recupera al vender un equipo (anti-softlock).
const PORCENTAJE_REEMBOLSO = 0.5;

// Reputación acotada a [0, 100] (CLAUDE.md §4). En 0 la partida termina.
const REPUTACION_MIN = 0;
const REPUTACION_MAX = 100;

// Valores con los que arranca (o se reinicia) una partida.
const REPUTACION_INICIAL = 50;
const CREDITOS_INICIALES = 1000;

// --- Tickets (solicitudes de clientes) ---
const TICKETS = Object.freeze({
  MAX_ACTIVOS: 5,               // pendientes + en proceso a la vez
  INTERVALO_SEGUNDOS: 45,       // tiempo mínimo entre un ticket nuevo y el siguiente
  SEGUNDOS_DECISION: 120,       // para aceptar o rechazar; si no, EXPIRA
  SEGUNDOS_PROCESO: 120,        // una vez aceptado, para entregarlo
  PENALIZACION_RECHAZO: 5,      // reputación al rechazar o dejar expirar (CLAUDE.md §5)
  NO_REPETIR_ULTIMOS: 8,        // no repetir un título entre los últimos N del jugador
  // Reputación necesaria para que los clientes pidan cada dificultad (escala 0-100)
  DESBLOQUEO: { facil: 0, media: 60, dificil: 80 },
  // Reputación que da / quita cada dificultad al completar / fallar
  REPUTACION: {
    facil: { recompensa: 3, penalizacion: 5 },
    media: { recompensa: 6, penalizacion: 9 },
    dificil: { recompensa: 12, penalizacion: 16 }
  }
});

// --- Ingresos pasivos y temperatura (CLAUDE.md §5 "Temperatura (3 Rangos)") ---
const INGRESOS = Object.freeze({
  // Créditos por minuto que genera cada TFLOP de un SERVIDOR encendido.
  // Los TFLOPS base del edificio no generan dinero.
  CREDITOS_POR_TFLOP_MIN: 1.0,
  // Con el juego cerrado se acumulan como máximo estos minutos de ingreso.
  MAX_MINUTOS_ACUMULABLES: 120,
  // Si se cobra al menos este tiempo de golpe (p. ej. al volver a abrir el
  // juego) se avisa al jugador con un evento INGRESO_PASIVO.
  SEGUNDOS_AVISO: 60
});

const TEMPERATURA = Object.freeze({
  ADVERTENCIA: 70,  // > 70 °C: thermal throttling
  CRITICA: 85,      // > 85 °C: apagado de emergencia (pendiente 2; hoy se trata como advertencia)
  MULTIPLICADOR_ADVERTENCIA: 0.6 // -40 % de ingresos pasivos en advertencia
});

module.exports = {
  INGRESOS,
  TEMPERATURA,
  TICKETS,
  REPUTACION_MIN,
  REPUTACION_MAX,
  REPUTACION_INICIAL,
  CREDITOS_INICIALES,
  BASE,
  TEMPERATURA_MINIMA,
  NUM_RACKS,
  U_POR_RACK,
  ESPACIO_TOTAL,
  PORCENTAJE_REEMBOLSO
};
