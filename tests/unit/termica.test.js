// Apagado de emergencia por temperatura crítica (> 85 °C), sin MySQL real.
const estado = require('../../src/services/estado.service');
const { BASE, TEMPERATURA } = require('../../src/config/juego');

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

describe('planApagadoEmergencia', () => {
  test('hasta 85 °C no apaga nada', () => {
    // 35 + 45 + 4 = 84 °C
    const items = [equipo({ impacto_temperatura: 45 }), equipo({ impacto_temperatura: 4 })];
    expect(estado.planApagadoEmergencia(items)).toEqual([]);
  });

  test('apaga primero el servidor que más calienta y se detiene al bajar de 85 °C', () => {
    const chico = equipo({ impacto_temperatura: 8 });
    const dgx = equipo({ impacto_temperatura: 45 });
    const medio = equipo({ impacto_temperatura: 14 });
    // 35 + 8 + 45 + 14 = 102 °C -> sin el DGX: 57 °C
    expect(estado.planApagadoEmergencia([chico, dgx, medio])).toEqual([dgx.id_inventario]);
  });

  test('si no basta con uno, sigue con el siguiente más caliente', () => {
    const a = equipo({ impacto_temperatura: 24 });
    const b = equipo({ impacto_temperatura: 24 });
    const c = equipo({ impacto_temperatura: 14 });
    const d = equipo({ impacto_temperatura: 14 });
    // 35 + 76 = 111 -> sin uno de 24: 87 -> sin el otro de 24: 63
    const ids = estado.planApagadoEmergencia([a, b, c, d]);
    expect(ids).toEqual([b.id_inventario, a.id_inventario]); // empate: el más nuevo primero
  });

  test('ignora los apagados y nunca toca refrigeración ni energía', () => {
    const apagado = equipo({ impacto_temperatura: 80, encendido: false });
    const servidor = equipo({ impacto_temperatura: 45 });
    const energia = equipo({ categoria: 'Energia', impacto_temperatura: 8 });
    const frio = equipo({ categoria: 'Refrigeracion', impacto_temperatura: -6 });
    // 35 + 45 + 8 - 6 = 82: no pasa de 85
    expect(estado.planApagadoEmergencia([apagado, servidor, energia, frio])).toEqual([]);
    // Sin la refrigeración (88 °C) se apaga el servidor, no la unidad de energía
    expect(estado.planApagadoEmergencia([servidor, energia])).toEqual([servidor.id_inventario]);
  });

  test('si con todos los servidores apagados sigue caliente, apaga red', () => {
    const red = equipo({ categoria: 'Redes', impacto_temperatura: 16 });
    const red2 = equipo({ categoria: 'Redes', impacto_temperatura: 16 });
    const red3 = equipo({ categoria: 'Redes', impacto_temperatura: 16 });
    const servidor = equipo({ impacto_temperatura: 8 });
    // 35 + 48 + 8 = 91 -> sin servidor: 83
    expect(estado.planApagadoEmergencia([red, red2, red3, servidor])).toEqual([servidor.id_inventario]);
    // 35 + 64 = 99 -> sin servidor 91 -> sin una red: 75
    const red4 = equipo({ categoria: 'Redes', impacto_temperatura: 16 });
    const ids = estado.planApagadoEmergencia([red, red2, red3, red4, servidor]);
    expect(ids[0]).toBe(servidor.id_inventario);
    expect(ids).toHaveLength(2);
  });

  test('no modifica la lista original', () => {
    const items = [equipo({ impacto_temperatura: 60 })];
    estado.planApagadoEmergencia(items);
    expect(items[0].encendido).toBe(true);
    expect(BASE.temperatura + 60).toBeGreaterThan(TEMPERATURA.CRITICA);
  });
});

describe('racks y equipos sobrecalentados', () => {
  test('construirRacks marca los equipos apagados por emergencia', () => {
    const racks = estado.construirRacks([
      equipo({ rack_numero: 1, slot_inicio: 0, encendido: false, motivo_apagado: 'OVERHEATED' }),
      equipo({ rack_numero: 1, slot_inicio: 1, encendido: false })
    ]);
    expect(racks[0].equipos.map((e) => e.sobrecalentado)).toEqual([true, false]);
  });

  test('normalizarItem lee motivo_apagado', () => {
    expect(estado.normalizarItem({ id_inventario: 1, encendido: 0, motivo_apagado: 'OVERHEATED' }).motivo_apagado).toBe('OVERHEATED');
    expect(estado.normalizarItem({ id_inventario: 1, encendido: 1 }).motivo_apagado).toBeNull();
  });
});
