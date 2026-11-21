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

module.exports = {
  BASE,
  TEMPERATURA_MINIMA,
  NUM_RACKS,
  U_POR_RACK,
  ESPACIO_TOTAL,
  PORCENTAJE_REEMBOLSO
};
