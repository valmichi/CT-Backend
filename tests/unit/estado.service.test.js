// Pruebas de las funciones puras de estado.service (no necesitan MySQL).
const estado = require('../../src/services/estado.service');
const { BASE, ESPACIO_TOTAL, U_POR_RACK, NUM_RACKS } = require('../../src/config/juego');

let siguienteId = 1;
const equipo = (extra = {}) => ({
  id_inventario: siguienteId++,
  nombreProducto: 'Equipo',
  categoria: 'Servidor',
  costo: 100,
  espacioNecesario: 1,
  aumento_teraflops: 0,
  impacto_temperatura: 0,
  aumento_memoria: 0,
  impacto_anchoDeBanda: 0,
  consumoElectrico: 0,
  aumento_watts: 0,
  encendido: true,
  rack_numero: null,
  slot_inicio: null,
  ...extra
});

describe('calcularMetricas', () => {
  test('sin equipos devuelve los valores base', () => {
    const m = estado.calcularMetricas([]);
    expect(m).toMatchObject({
      teraflops: BASE.teraflops,
      memoria: BASE.memoria,
      temperatura: BASE.temperatura,
      carga_electrica: BASE.carga_electrica,
      capacidad_watts: BASE.capacidad_watts,
      espacio_usado: 0,
      espacio_total: ESPACIO_TOTAL
    });
  });

  test('un equipo apagado ocupa espacio pero no aporta, no consume ni calienta', () => {
    const m = estado.calcularMetricas([
      equipo({ espacioNecesario: 2, aumento_teraflops: 45, consumoElectrico: 380, impacto_temperatura: 14, encendido: false })
    ]);
    expect(m.espacio_usado).toBe(2);
    expect(m.teraflops).toBe(BASE.teraflops);
    expect(m.carga_electrica).toBe(BASE.carga_electrica);
    expect(m.temperatura).toBe(BASE.temperatura);
  });

  test('suma equipos encendidos y la refrigeración no baja de la temperatura mínima', () => {
    const m = estado.calcularMetricas([
      equipo({ aumento_teraflops: 8, aumento_memoria: 16, consumoElectrico: 120, impacto_temperatura: 4 }),
      equipo({ categoria: 'Energia', aumento_watts: 400, consumoElectrico: 10 }),
      equipo({ categoria: 'Refrigeracion', impacto_temperatura: -80 })
    ]);
    expect(m.teraflops).toBe(BASE.teraflops + 8);
    expect(m.memoria).toBe(BASE.memoria + 16);
    expect(m.carga_electrica).toBe(BASE.carga_electrica + 130);
    expect(m.capacidad_watts).toBe(BASE.capacidad_watts + 400);
    expect(m.temperatura).toBe(18);
  });
});

describe('buscarHueco', () => {
  test('el primer equipo va al rack 1, slot 0', () => {
    expect(estado.buscarHueco([], 2)).toEqual({ rack_numero: 1, slot_inicio: 0 });
  });

  test('busca un hueco contiguo y no parte el equipo entre racks', () => {
    // Rack 1 con 13 U ocupadas: un equipo de 2U ya no cabe ahí.
    const items = [equipo({ espacioNecesario: 13, rack_numero: 1, slot_inicio: 0 })];
    expect(estado.buscarHueco(items, 1)).toEqual({ rack_numero: 1, slot_inicio: 13 });
    expect(estado.buscarHueco(items, 2)).toEqual({ rack_numero: 2, slot_inicio: 0 });
  });

  test('reutiliza el hueco que deja un equipo vendido', () => {
    const items = [
      equipo({ espacioNecesario: 2, rack_numero: 1, slot_inicio: 0 }),
      equipo({ espacioNecesario: 3, rack_numero: 1, slot_inicio: 5 })
    ];
    expect(estado.buscarHueco(items, 3)).toEqual({ rack_numero: 1, slot_inicio: 2 });
  });

  test('devuelve null cuando todos los racks están llenos', () => {
    const llenos = Array.from({ length: NUM_RACKS }, (_, r) =>
      equipo({ espacioNecesario: U_POR_RACK, rack_numero: r + 1, slot_inicio: 0 }));
    expect(estado.buscarHueco(llenos, 1)).toBeNull();
  });
});

describe('construirRacks y precioVenta', () => {
  test('agrupa los equipos por rack con su espacio usado', () => {
    const racks = estado.construirRacks([
      equipo({ espacioNecesario: 2, rack_numero: 1, slot_inicio: 0 }),
      equipo({ espacioNecesario: 4, rack_numero: 2, slot_inicio: 0, encendido: false })
    ]);
    expect(racks).toHaveLength(NUM_RACKS);
    expect(racks[0]).toMatchObject({ id_rack: 1, espacio_total: U_POR_RACK, espacio_usado: 2 });
    expect(racks[1].equipos[0]).toMatchObject({ espacio: 4, encendido: false });
    expect(racks[2].espacio_usado).toBe(0);
  });

  test('el precio de venta es la mitad del costo', () => {
    expect(estado.precioVenta('550.00')).toBe(275);
  });
});
