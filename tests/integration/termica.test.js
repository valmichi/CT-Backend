// Zona crítica (> 85 °C): apagado de emergencia contra MySQL real.
// Se ejecuta solo si RUN_INTEGRATION=true, igual que las demás de integración.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// id_producto del catálogo semilla (init.sql)
const P = { X12: 4, DGX: 5, SUBMARINO: 10, TESLA: 15 };

describeIntegracion('Apagado de emergencia por temperatura crítica', () => {
  const sufijo = Date.now();
  const ctx = {};

  // Instala un equipo encendido sin pasar por la tienda (sin validar energía);
  // rack_numero NULL: estado.asegurarUbicaciones le asigna lugar.
  const instalar = async (id_producto, encendido = true) => {
    const [r] = await db.query(
      'INSERT INTO Inventario_Usuario (id_usuario, id_producto, encendido) VALUES (?, ?, ?)',
      [ctx.id_alumno, id_producto, encendido]
    );
    return r.insertId;
  };
  const equipo = async (id_inventario) => {
    const [[fila]] = await db.query('SELECT encendido, motivo_apagado FROM Inventario_Usuario WHERE id_inventario = ?', [id_inventario]);
    return { encendido: Boolean(fila.encendido), motivo_apagado: fila.motivo_apagado };
  };
  const usuario = async () => {
    const [[u]] = await db.query('SELECT creditos, reputacion FROM Usuarios WHERE id_usuario = ?', [ctx.id_alumno]);
    return { creditos: Number(u.creditos), reputacion: Number(u.reputacion) };
  };
  const cambiar = (id, encendido) =>
    request(app).post(`/api/inventario/${id}/estado`).set(auth(ctx.token)).send({ encendido });

  beforeAll(async () => {
    const profesor = { nombre: 'Profe Termica', correo: `termica_${sufijo}@universidad.edu`, password: 'PasswordTermica2026' };
    await request(app).post('/api/profesor/registro').send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });
    const login = await request(app).post('/api/profesor/login').send({ correo: profesor.correo, password: profesor.password });
    const clase = await request(app).post('/api/profesor/clases').set(auth(login.body.token)).send({ nombre_clase: 'Grupo Termica' });
    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(login.body.token))
      .send({ nombreUsuario: 'alumno_termica' });
    const alumno = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno_termica', codigo_clase: clase.body.codigo_clase });
    ctx.id_alumno = alta.body.id_usuario;
    ctx.token = alumno.body.token;

    // 35 + 45 (DGX) + 24 (X12) + 8 (Tésla, +6500 W) - 80 (SubMarino) = 32 °C
    await instalar(P.TESLA);
    ctx.dgx = await instalar(P.DGX);
    ctx.x12 = await instalar(P.X12);
    ctx.frio = await instalar(P.SUBMARINO);
    // Sin ingresos pasivos en esta suite (con estos servidores serían ~6 créditos
    // por segundo y moverían los créditos entre lecturas): reloj en el futuro.
    await db.query('UPDATE Usuarios SET ultimo_cobro = NOW() + INTERVAL 1 DAY WHERE id_usuario = ?', [ctx.id_alumno]);
  });

  afterAll(async () => {
    await db.end();
  });

  test('con refrigeración la temperatura está en zona segura', async () => {
    const res = await request(app).get('/api/usuario/dashboard').set(auth(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.metricas).toMatchObject({ temperatura: 32, status: 'OK' });
    expect(res.body.eventos.some((e) => e.tipo === 'APAGADO_EMERGENCIA')).toBe(false);
  });

  test('apagar la refrigeración apaga el servidor más caliente y fallan los tickets sin capacidad', async () => {
    // "Servidor Streaming Video" pide 350 de ancho de banda: hay 700 (100 + DGX 400 + X12 200)
    await request(app).post('/api/tickets/generar-demo').set(auth(ctx.token));
    const pendientes = await request(app).get('/api/tickets/pendientes').set(auth(ctx.token));
    const streaming = pendientes.body.find((t) => t.descripcion === 'Servidor Streaming Video');
    const acepta = await request(app).post(`/api/tickets/${streaming.id_ticket}/aceptar`).set(auth(ctx.token));
    expect(acepta.status).toBe(200);
    const antes = await usuario();

    // Sin el SubMarino: 112 °C -> apagado de emergencia del DGX (+45) -> 67 °C
    const res = await cambiar(ctx.frio, false);
    expect(res.status).toBe(200);
    expect(res.body.encendido).toBe(false);
    expect(res.body.mensaje).toMatch(/Apagado de emergencia/);

    const emergencia = res.body.eventos.find((e) => e.tipo === 'APAGADO_EMERGENCIA');
    expect(emergencia).toMatchObject({ temperatura_antes: 112, temperatura_despues: 67 });
    expect(emergencia.equipos.map((e) => e.id_inventario)).toEqual([ctx.dgx]);
    expect(res.body.estado.metricas).toMatchObject({ temperatura: 67, status: 'OK' });

    const enRack = res.body.estado.racks.flatMap((r) => r.equipos).find((e) => e.id_inventario === ctx.dgx);
    expect(enRack).toMatchObject({ encendido: false, sobrecalentado: true });
    expect(await equipo(ctx.dgx)).toEqual({ encendido: false, motivo_apagado: 'OVERHEATED' });
    expect((await equipo(ctx.x12)).encendido).toBe(true); // con uno bastó

    // Sin el DGX quedan 300 de ancho de banda: el ticket de 350 falla en ese momento
    const fallido = res.body.eventos.find((e) => e.tipo === 'FALLIDO');
    expect(fallido).toMatchObject({ id_ticket: streaming.id_ticket, motivo: 'OVERHEATED', creditos: -100, reputacion: -20 });
    const [[t]] = await db.query('SELECT estado FROM Tickets_Soporte WHERE id_ticket = ?', [streaming.id_ticket]);
    expect(t.estado).toBe('fallido');
    expect(await usuario()).toEqual({ creditos: antes.creditos - 100, reputacion: antes.reputacion - 20 });
  });

  test('no se puede reencender un equipo sobrecalentado sin refrigeración suficiente', async () => {
    const res = await cambiar(ctx.dgx, true);
    expect(res.status).toBe(409);
    expect(res.body.codigo).toBe('OVERHEATED');
    expect(await equipo(ctx.dgx)).toEqual({ encendido: false, motivo_apagado: 'OVERHEATED' });
  });

  test('con la refrigeración de vuelta se reenciende y se borra la marca', async () => {
    expect((await cambiar(ctx.frio, true)).status).toBe(200);
    const res = await cambiar(ctx.dgx, true);
    expect(res.status).toBe(200);
    expect(res.body.encendido).toBe(true);
    expect(res.body.eventos).toEqual([]);
    expect(await equipo(ctx.dgx)).toEqual({ encendido: true, motivo_apagado: null });
  });

  test('una partida que quedó arriba de 85 °C se corrige al consultar el dashboard', async () => {
    await db.query('UPDATE Inventario_Usuario SET encendido = FALSE WHERE id_inventario = ?', [ctx.frio]);
    const res = await request(app).get('/api/usuario/dashboard').set(auth(ctx.token));
    expect(res.status).toBe(200);
    const emergencia = res.body.eventos.find((e) => e.tipo === 'APAGADO_EMERGENCIA');
    expect(emergencia.equipos.map((e) => e.id_inventario)).toEqual([ctx.dgx]);
    expect(res.body.metricas.temperatura).toBe(67);
  });

  test('comprar un servidor que hace pasar de 85 °C lo apaga en la misma compra', async () => {
    await db.query('UPDATE Usuarios SET creditos = 10000 WHERE id_usuario = ?', [ctx.id_alumno]);

    // 67 + 45 = 112 °C: el más caliente encendido es el DGX nuevo
    const res = await request(app).post('/api/tienda/comprar').set(auth(ctx.token)).send({ id_producto: P.DGX });
    expect(res.status).toBe(200);
    expect(res.body.aviso).toBe('OVERHEATED');
    expect(res.body.encendido).toBe(false);
    const emergencia = res.body.eventos.find((e) => e.tipo === 'APAGADO_EMERGENCIA');
    expect(emergencia.equipos.map((e) => e.id_inventario)).toEqual([res.body.id_inventario]);
    expect(res.body.estado.metricas.temperatura).toBe(67);
    expect(await equipo(res.body.id_inventario)).toEqual({ encendido: false, motivo_apagado: 'OVERHEATED' });
  });
});
