// Ingresos pasivos y zona de advertencia de temperatura (sin MySQL real).
const estado = require('../../src/services/estado.service');
const ingresos = require('../../src/services/ingresos.service');
const { INGRESOS, TEMPERATURA, BASE } = require('../../src/config/juego');

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

describe('zona de temperatura', () => {
  test(`hasta ${TEMPERATURA.ADVERTENCIA} °C es zona segura`, () => {
    expect(estado.zonaTemperatura(TEMPERATURA.ADVERTENCIA)).toBe('OK');
    expect(estado.multiplicadorTemperatura(TEMPERATURA.ADVERTENCIA)).toBe(1);
  });

  test('de 71 a 85 °C es advertencia con -40 %', () => {
    for (const t of [TEMPERATURA.ADVERTENCIA + 1, TEMPERATURA.CRITICA]) {
      expect(estado.zonaTemperatura(t)).toBe('WARNING');
      expect(estado.multiplicadorTemperatura(t)).toBe(0.6);
    }
  });

  test('arriba de 85 °C es zona crítica y no genera ingresos', () => {
    expect(estado.zonaTemperatura(TEMPERATURA.CRITICA + 1)).toBe('CRITICAL');
    expect(estado.multiplicadorTemperatura(TEMPERATURA.CRITICA + 1)).toBe(0);
  });
});

describe('calcularIngresos', () => {
  test('sin servidores no hay ingreso (los TFLOPS base no pagan)', () => {
    const r = estado.calcularIngresos([]);
    expect(BASE.teraflops).toBeGreaterThan(0);
    expect(r).toEqual({
      ingreso_base_por_minuto: 0,
      ingreso_por_minuto: 0,
      multiplicador_ingresos: 1,
      status: 'OK',
      warning: null
    });
  });

  test('solo cuentan los servidores encendidos', () => {
    const items = [
      equipo({ aumento_teraflops: 8 }),
      equipo({ aumento_teraflops: 22, encendido: false }),
      equipo({ categoria: 'Redes', aumento_teraflops: 50 })
    ];
    const r = estado.calcularIngresos(items);
    expect(r.ingreso_base_por_minuto).toBe(8 * INGRESOS.CREDITOS_POR_TFLOP_MIN);
    expect(r.ingreso_por_minuto).toBe(8 * INGRESOS.CREDITOS_POR_TFLOP_MIN);
  });

  test('en advertencia se recorta el ingreso y se avisa', () => {
    // 35 °C base + 45 = 80 °C (como un DGX sin refrigeración)
    const items = [equipo({ aumento_teraflops: 250, impacto_temperatura: 45 })];
    const r = estado.calcularIngresos(items);
    expect(r.status).toBe('WARNING');
    expect(r.warning).toBe('HIGH_TEMPERATURE');
    expect(r.ingreso_base_por_minuto).toBe(250);
    expect(r.ingreso_por_minuto).toBe(150);
  });

  test('la refrigeración saca de la advertencia', () => {
    const items = [
      equipo({ aumento_teraflops: 250, impacto_temperatura: 45 }),
      equipo({ categoria: 'Refrigeracion', impacto_temperatura: -12 })
    ];
    const r = estado.calcularIngresos(items);
    expect(r.status).toBe('OK');
    expect(r.ingreso_por_minuto).toBe(250);
  });

  test('formatearEstado incluye ingresos y status en las métricas', () => {
    const e = estado.formatearEstado({ creditos: '0', reputacion: 50 }, [equipo({ aumento_teraflops: 8 })]);
    expect(e.metricas).toMatchObject({ ingreso_por_minuto: 8, status: 'OK', warning: null });
  });
});

describe('calcularCobro', () => {
  test('cobra proporcional a los segundos', () => {
    expect(estado.calcularCobro(30, 8)).toEqual({ segundos: 30, excedido: false, monto: 4 });
    expect(estado.calcularCobro(5, 8)).toEqual({ segundos: 5, excedido: false, monto: 0.67 });
  });

  test('aplica el tope de minutos acumulables', () => {
    const tope = INGRESOS.MAX_MINUTOS_ACUMULABLES * 60;
    const r = estado.calcularCobro(tope * 3, 10);
    expect(r).toEqual({ segundos: tope, excedido: true, monto: 10 * INGRESOS.MAX_MINUTOS_ACUMULABLES });
  });

  test('tiempos negativos o nulos no cobran', () => {
    expect(estado.calcularCobro(-20, 10).monto).toBe(0);
    expect(estado.calcularCobro(null, 10).monto).toBe(0);
  });
});

describe('cobrarIngresos (conexión simulada)', () => {
  // Respuestas en orden: fila de Usuarios, inventario, y luego los UPDATE/INSERT.
  const conexion = (usuario, inventario = []) => {
    const conn = { query: jest.fn() };
    conn.query
      .mockResolvedValueOnce([[usuario]])
      .mockResolvedValueOnce([inventario])
      .mockResolvedValue([{ affectedRows: 1 }]);
    return conn;
  };
  const servidor = { id_inventario: 1, id_producto: 1, categoria: 'Servidor', aumento_teraflops: 8, impacto_temperatura: 4, encendido: 1, espacioNecesario: 1 };

  test('avanza ultimo_cobro solo lo que cobró', async () => {
    const conn = conexion({ estado_partida: 'ACTIVE', sin_cobro: 0, segundos: 30 }, [servidor]);
    const r = await ingresos.cobrarIngresos(conn, 7);
    expect(r).toMatchObject({ monto: 4, segundos: 30 });
    const [sql, params] = conn.query.mock.calls[2];
    expect(sql).toMatch(/ultimo_cobro = ultimo_cobro \+ INTERVAL \? SECOND/);
    expect(params).toEqual([4, 30, 7]);
    expect(ingresos.eventoIngreso(r)).toBeNull(); // cobro corto: sin aviso
  });

  test('un cobro largo se registra y genera evento INGRESO_PASIVO', async () => {
    const conn = conexion({ estado_partida: 'ACTIVE', sin_cobro: 0, segundos: 600 }, [servidor]);
    const r = await ingresos.cobrarIngresos(conn, 7);
    expect(r.monto).toBe(80);
    expect(conn.query.mock.calls[3][1]).toEqual(expect.arrayContaining(['INGRESO_PASIVO']));
    expect(ingresos.eventoIngreso(r)).toMatchObject({ tipo: 'INGRESO_PASIVO', creditos: 80, segundos: 600 });
  });

  test('pasado el tope se paga el tope y el reloj salta a NOW()', async () => {
    const conn = conexion({ estado_partida: 'ACTIVE', sin_cobro: 0, segundos: 999999 }, [servidor]);
    const r = await ingresos.cobrarIngresos(conn, 7);
    expect(r.monto).toBe(8 * INGRESOS.MAX_MINUTOS_ACUMULABLES);
    expect(conn.query.mock.calls[2][0]).toMatch(/ultimo_cobro = NOW\(\)/);
  });

  test('en GAME_OVER no paga nada, solo mueve el reloj', async () => {
    const conn = { query: jest.fn().mockResolvedValueOnce([[{ estado_partida: 'GAME_OVER', sin_cobro: 0, segundos: 600 }]]).mockResolvedValue([{}]) };
    const r = await ingresos.cobrarIngresos(conn, 7);
    expect(r.monto).toBe(0);
    expect(conn.query).toHaveBeenCalledTimes(2);
    expect(conn.query.mock.calls[1][0]).toMatch(/SET ultimo_cobro = NOW\(\)/);
  });
});
