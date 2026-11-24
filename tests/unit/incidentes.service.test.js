// Funciones puras de incidentes y del apagón parcial (no necesitan MySQL).
const incidentes = require('../../src/services/incidentes.service');
const estado = require('../../src/services/estado.service');
const catalogo = require('../../src/config/incidentes.catalogo');
const { INCIDENTES, BASE } = require('../../src/config/juego');

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
  motivo_apagado: null,
  rack_numero: null,
  slot_inicio: null,
  ...extra
});
const FALLA = { reduccion_capacidad: INCIDENTES.REDUCCION_CAPACIDAD_FALLA_ELECTRICA };

describe('capacidad eléctrica con falla', () => {
  test('sin ajustes la capacidad es la normal', () => {
    expect(estado.calcularMetricas([]).capacidad_watts).toBe(BASE.capacidad_watts);
  });

  test('con falla eléctrica la capacidad baja 40 % y se informa la normal', () => {
    const m = estado.calcularMetricas([], FALLA);
    expect(m.capacidad_watts).toBe(Math.floor(BASE.capacidad_watts * 0.6));
    expect(m.capacidad_watts_normal).toBe(BASE.capacidad_watts);
  });
});

describe('planApagonParcial', () => {
  test('si el consumo cabe no apaga nada', () => {
    expect(estado.planApagonParcial([equipo({ consumoElectrico: 120 })], FALLA)).toEqual([]);
  });

  test('apaga del último instalado al primero solo hasta equilibrar', () => {
    // base 250 W + 3 x 120 W = 610 W > 600 W con falla: basta apagar el último
    const a = equipo({ consumoElectrico: 120 });
    const b = equipo({ consumoElectrico: 120 });
    const c = equipo({ consumoElectrico: 120 });
    expect(estado.planApagonParcial([a, b, c], FALLA)).toEqual([c.id_inventario]);
  });

  test('nunca apaga refrigeración ni energía; si no bastan servidores, sigue con red', () => {
    const frio = equipo({ categoria: 'Refrigeracion', consumoElectrico: 200 });
    const red = equipo({ categoria: 'Redes', consumoElectrico: 220 });
    const srv = equipo({ consumoElectrico: 120 });
    // 250 + 200 + 220 + 120 = 790 W > 600 W: primero el servidor, luego la red
    expect(estado.planApagonParcial([frio, red, srv], FALLA)).toEqual([srv.id_inventario, red.id_inventario]);
  });
});

describe('incidentes', () => {
  test('el siguiente incidente llega entre 2 y 4 minutos', () => {
    expect(incidentes.segundosHastaSiguiente(() => 0)).toBe(INCIDENTES.INTERVALO_MIN_SEGUNDOS);
    expect(incidentes.segundosHastaSiguiente(() => 0.9999)).toBe(INCIDENTES.INTERVALO_MAX_SEGUNDOS);
  });

  test('las opciones incluyen la correcta, sin repetir, y del tamaño configurado', () => {
    for (const inc of catalogo.INCIDENTES) {
      const opciones = incidentes.armarOpciones(inc.accion_requerida);
      expect(opciones).toHaveLength(INCIDENTES.OPCIONES_POR_INCIDENTE);
      expect(opciones).toContain(inc.accion_requerida);
      expect(new Set(opciones).size).toBe(opciones.length);
      expect(opciones.every((o) => catalogo.ACCIONES[o])).toBe(true);
    }
  });

  test('cada tipo del catálogo tiene una acción correcta válida', () => {
    expect(catalogo.INCIDENTES.map((i) => i.tipo)).toContain('FALLA_ELECTRICA');
    expect(catalogo.INCIDENTES.every((i) => catalogo.ACCIONES[i.accion_requerida])).toBe(true);
  });

  test('formatearIncidente nunca revela la acción correcta', () => {
    const f = incidentes.formatearIncidente({
      id_incidente: 3, tipo: 'ATAQUE_SEGURIDAD', descripcion: 'x', accion_requerida: 'BLOQUEAR_IPS_FIREWALL',
      opciones_json: '["IGNORAR_ALERTA","BLOQUEAR_IPS_FIREWALL"]', segundos_restantes: -4
    });
    expect(f.accion_requerida).toBeUndefined();
    expect(f.opciones).toEqual([
      { id: 'IGNORAR_ALERTA', texto: catalogo.ACCIONES.IGNORAR_ALERTA },
      { id: 'BLOQUEAR_IPS_FIREWALL', texto: catalogo.ACCIONES.BLOQUEAR_IPS_FIREWALL }
    ]);
    expect(f.segundos_restantes).toBe(0);
  });
});
