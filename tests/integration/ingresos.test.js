// Ingresos pasivos y zona de advertencia de temperatura contra MySQL real.
// Se ejecuta solo si RUN_INTEGRATION=true, igual que las demás de integración.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const { INGRESOS } = require('../../src/config/juego');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describeIntegracion('Ingresos pasivos y temperatura', () => {
  const sufijo = Date.now();
  const ctx = {};

  const creditos = async () => {
    const [[u]] = await db.query('SELECT creditos FROM Usuarios WHERE id_usuario = ?', [ctx.id_alumno]);
    return Number(u.creditos);
  };
  // Simula que pasó tiempo desde el último cobro.
  const atrasarCobro = (minutos) =>
    db.query('UPDATE Usuarios SET ultimo_cobro = NOW() - INTERVAL ? MINUTE WHERE id_usuario = ?', [minutos, ctx.id_alumno]);
  const dashboard = () => request(app).get('/api/usuario/dashboard').set(auth(ctx.token));

  beforeAll(async () => {
    const profesor = { nombre: 'Profe Ingresos', correo: `ingresos_${sufijo}@universidad.edu`, password: 'PasswordIngresos2026' };
    await request(app).post('/api/profesor/registro').send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });
    const login = await request(app).post('/api/profesor/login').send({ correo: profesor.correo, password: profesor.password });
    const clase = await request(app).post('/api/profesor/clases').set(auth(login.body.token)).send({ nombre_clase: 'Grupo Ingresos' });
    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(login.body.token))
      .send({ nombreUsuario: 'alumno_ingresos' });
    const alumno = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno_ingresos', codigo_clase: clase.body.codigo_clase });
    ctx.id_alumno = alta.body.id_usuario;
    ctx.token = alumno.body.token;
  });

  afterAll(async () => {
    await db.end();
  });

  test('sin servidores no hay ingreso y la temperatura está en zona segura', async () => {
    const res = await dashboard();
    expect(res.status).toBe(200);
    expect(res.body.metricas).toMatchObject({ ingreso_por_minuto: 0, status: 'OK', warning: null });
  });

  test('un servidor encendido genera créditos por minuto', async () => {
    const compra = await request(app).post('/api/tienda/comprar').set(auth(ctx.token)).send({ id_producto: 1 }); // R110: 8 TFLOPS
    expect(compra.status).toBe(200);
    ctx.id_r110 = compra.body.id_inventario;
    expect(compra.body.estado.metricas.ingreso_por_minuto).toBe(8);

    const antes = await creditos();
    await atrasarCobro(10);
    const res = await dashboard();
    const ganado = (await creditos()) - antes;
    expect(ganado).toBeGreaterThanOrEqual(80);
    expect(ganado).toBeLessThan(81);
    const ev = res.body.eventos.find((e) => e.tipo === 'INGRESO_PASIVO');
    expect(ev).toBeDefined();
    expect(ev.creditos).toBeCloseTo(ganado, 2);
  });

  test('consultas seguidas no pagan dos veces el mismo tiempo', async () => {
    const antes = await creditos();
    await dashboard();
    await dashboard();
    expect((await creditos()) - antes).toBeLessThan(1);
  });

  test('con el juego cerrado se acumula como máximo el tope', async () => {
    const antes = await creditos();
    await atrasarCobro(INGRESOS.MAX_MINUTOS_ACUMULABLES * 5);
    await dashboard();
    expect((await creditos()) - antes).toBeCloseTo(8 * INGRESOS.MAX_MINUTOS_ACUMULABLES, 2);
    const [[u]] = await db.query('SELECT TIMESTAMPDIFF(SECOND, ultimo_cobro, NOW()) AS s FROM Usuarios WHERE id_usuario = ?', [ctx.id_alumno]);
    expect(Number(u.s)).toBeLessThan(5);
  });

  test('antes de apagar un equipo se cobra lo generado con él', async () => {
    const antes = await creditos();
    await atrasarCobro(10);
    const res = await request(app).post(`/api/inventario/${ctx.id_r110}/estado`).set(auth(ctx.token)).send({ encendido: false });
    expect(res.status).toBe(200);
    expect(res.body.estado.metricas.ingreso_por_minuto).toBe(0);
    expect((await creditos()) - antes).toBeGreaterThanOrEqual(80);
  });

  test('entre 71 y 85 °C se avisa y el ingreso baja 40 %', async () => {
    await request(app).post(`/api/inventario/${ctx.id_r110}/estado`).set(auth(ctx.token)).send({ encendido: true });
    // DGX (250 TFLOPS, +45 °C) instalado y encendido a mano: con la energía base no se podría.
    await db.query(
      'INSERT INTO Inventario_Usuario (id_usuario, id_producto, encendido, rack_numero, slot_inicio) VALUES (?, 5, 1, 2, 0)',
      [ctx.id_alumno]
    );
    await db.query('UPDATE Usuarios SET ultimo_cobro = NOW() WHERE id_usuario = ?', [ctx.id_alumno]);

    const res = await dashboard();
    const m = res.body.metricas;
    expect(m.temperatura).toBe(84); // 35 + 4 + 45
    expect(m).toMatchObject({ status: 'WARNING', warning: 'HIGH_TEMPERATURE', ingreso_base_por_minuto: 258 });
    expect(m.ingreso_por_minuto).toBeCloseTo(154.8, 2);

    const antes = await creditos();
    await atrasarCobro(10);
    await dashboard();
    const ganado = (await creditos()) - antes;
    expect(ganado).toBeGreaterThanOrEqual(1548);
    expect(ganado).toBeLessThan(1548 + 154.8 / 60 * 3);
  });

  test('en GAME_OVER no se generan ingresos', async () => {
    await db.query("UPDATE Usuarios SET estado_partida = 'GAME_OVER', reputacion = 0 WHERE id_usuario = ?", [ctx.id_alumno]);
    const antes = await creditos();
    await atrasarCobro(30);
    await dashboard();
    expect(await creditos()).toBe(antes);
  });

  test('al reiniciar no se cobra el tiempo que pasó en GAME_OVER', async () => {
    await atrasarCobro(30);
    const res = await request(app).post('/api/usuario/reset').set(auth(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.metricas.ingreso_por_minuto).toBe(0);
    await dashboard();
    expect(await creditos()).toBe(1000);
  });
});
