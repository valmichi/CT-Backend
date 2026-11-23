// Tickets entregados en zona de advertencia (71-85 °C): -25 % de créditos.
// Se ejecuta solo si RUN_INTEGRATION=true, igual que las demás de integración.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describeIntegracion('Recompensa de tickets según la temperatura', () => {
  const sufijo = Date.now();
  const ctx = {};

  const usuario = async () => {
    const [[u]] = await db.query('SELECT creditos, reputacion FROM Usuarios WHERE id_usuario = ?', [ctx.id_alumno]);
    return { creditos: Number(u.creditos), reputacion: Number(u.reputacion) };
  };
  // Acepta un "Hospedaje Web PYME" nuevo (12 TFLOPS, 150 créditos, +10 reputación)
  // y adelanta su entrega para que ya esté lista.
  const ticketListo = async () => {
    await request(app).post('/api/tickets/generar-demo').set(auth(ctx.token));
    const pendientes = await request(app).get('/api/tickets/pendientes').set(auth(ctx.token));
    const t = pendientes.body.filter((x) => x.descripcion === 'Hospedaje Web PYME').pop();
    const acepta = await request(app).post(`/api/tickets/${t.id_ticket}/aceptar`).set(auth(ctx.token));
    expect(acepta.status).toBe(200);
    await db.query('UPDATE Tickets_Soporte SET fecha_entrega = NOW() - INTERVAL 1 SECOND WHERE id_ticket = ?', [t.id_ticket]);
    return t.id_ticket;
  };

  beforeAll(async () => {
    const profesor = { nombre: 'Profe Tickets Temp', correo: `ticktemp_${sufijo}@universidad.edu`, password: 'PasswordTickTemp2026' };
    await request(app).post('/api/profesor/registro').send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });
    const login = await request(app).post('/api/profesor/login').send({ correo: profesor.correo, password: profesor.password });
    const clase = await request(app).post('/api/profesor/clases').set(auth(login.body.token)).send({ nombre_clase: 'Grupo Tickets Temp' });
    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(login.body.token))
      .send({ nombreUsuario: 'alumno_ticktemp' });
    const alumno = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno_ticktemp', codigo_clase: clase.body.codigo_clase });
    ctx.id_alumno = alta.body.id_usuario;
    ctx.token = alumno.body.token;

    await request(app).post('/api/tienda/comprar').set(auth(ctx.token)).send({ id_producto: 1 }); // R110: 18 TFLOPS, 39 °C
    // Sin ingresos pasivos en esta suite, para comparar créditos exactos.
    await db.query('UPDATE Usuarios SET ultimo_cobro = NOW() + INTERVAL 1 DAY WHERE id_usuario = ?', [ctx.id_alumno]);
  });

  afterAll(async () => {
    await db.end();
  });

  test('en zona segura el ticket paga la recompensa completa', async () => {
    const id = await ticketListo();
    const antes = await usuario();
    const res = await request(app).get('/api/tickets').set(auth(ctx.token));
    const ev = res.body.eventos.find((e) => e.id_ticket === id);
    expect(ev).toMatchObject({ tipo: 'COMPLETADO', creditos: 150 });
    expect(ev.recorte_temperatura).toBeUndefined();
    expect(await usuario()).toEqual({ creditos: antes.creditos + 150, reputacion: antes.reputacion + 10 });
  });

  test('en zona de advertencia paga 25 % menos y la reputación no cambia', async () => {
    // DGX encendido a mano: 35 + 4 + 45 = 84 °C (advertencia, sin apagado de emergencia)
    await db.query(
      'INSERT INTO Inventario_Usuario (id_usuario, id_producto, encendido) VALUES (?, 5, TRUE)',
      [ctx.id_alumno]
    );
    const id = await ticketListo();
    const antes = await usuario();
    const res = await request(app).get('/api/tickets').set(auth(ctx.token));
    expect(res.body.estado.metricas).toMatchObject({ temperatura: 84, status: 'WARNING' });
    const ev = res.body.eventos.find((e) => e.id_ticket === id);
    expect(ev).toMatchObject({ tipo: 'COMPLETADO', creditos: 112.5, recorte_temperatura: true, recompensa_completa: 150, reputacion: 10 });
    expect(await usuario()).toEqual({ creditos: antes.creditos + 112.5, reputacion: antes.reputacion + 10 });
  });
});
