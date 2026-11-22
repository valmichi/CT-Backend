// Reputación acotada a [0, 100], fin de partida (GAME_OVER) y reinicio.
// Se ejecuta solo si RUN_INTEGRATION=true, igual que las demás de integración.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describeIntegracion('Reputación, Game Over y reinicio de partida', () => {
  const sufijo = Date.now();
  const ctx = {};

  const leer = async () => {
    const [rows] = await db.query(
      'SELECT creditos, reputacion, estado_partida, contratos_finalizados FROM Usuarios WHERE id_usuario = ?',
      [ctx.id_alumno]
    );
    return { ...rows[0], creditos: Number(rows[0].creditos) };
  };

  // Tickets demo; devuelve el "Hospedaje Web PYME" más nuevo (pide 12 TFLOPS).
  const nuevoTicket = async () => {
    await request(app).post('/api/tickets/generar-demo').set(auth(ctx.token));
    const res = await request(app).get('/api/tickets/pendientes').set(auth(ctx.token));
    return res.body.filter((t) => t.descripcion === 'Hospedaje Web PYME').pop();
  };

  beforeAll(async () => {
    const profesor = { nombre: 'Profe Partida', correo: `partida_${sufijo}@universidad.edu`, password: 'PasswordPartida2026' };
    await request(app).post('/api/profesor/registro').send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });
    const login = await request(app).post('/api/profesor/login').send({ correo: profesor.correo, password: profesor.password });
    const clase = await request(app).post('/api/profesor/clases').set(auth(login.body.token)).send({ nombre_clase: 'Grupo Partida' });
    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(login.body.token))
      .send({ nombreUsuario: 'alumno_partida' });
    const alumno = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno_partida', codigo_clase: clase.body.codigo_clase });
    ctx.id_alumno = alta.body.id_usuario;
    ctx.token = alumno.body.token;
  });

  afterAll(async () => {
    await db.end();
  });

  test('la reputación nunca pasa de 100', async () => {
    await db.query('UPDATE Usuarios SET reputacion = 95 WHERE id_usuario = ?', [ctx.id_alumno]);
    await request(app).post('/api/tienda/comprar').set(auth(ctx.token)).send({ id_producto: 1 }); // 18 TFLOPS
    const ticket = await nuevoTicket();

    const acepta = await request(app).post(`/api/tickets/${ticket.id_ticket}/aceptar`).set(auth(ctx.token));
    expect(acepta.status).toBe(200);
    await db.query('UPDATE Tickets_Soporte SET fecha_entrega = NOW() - INTERVAL 1 SECOND WHERE id_ticket = ?', [ticket.id_ticket]);
    const res = await request(app).post('/api/tickets/resolver').set(auth(ctx.token)).send({ id_ticket: ticket.id_ticket });

    expect(res.status).toBe(200);
    expect(res.body.exito).toBe(true);
    expect(res.body.reputacionActual).toBe(100);
    expect((await leer()).reputacion).toBe(100);
  });

  test('al llegar a 0 la partida pasa a GAME_OVER', async () => {
    await db.query('UPDATE Usuarios SET reputacion = 5 WHERE id_usuario = ?', [ctx.id_alumno]);
    const ticket = await nuevoTicket();

    // Rechazar quita 5: de 5 pasa a 0
    const res = await request(app).post(`/api/tickets/${ticket.id_ticket}/rechazar`).set(auth(ctx.token));

    expect(res.status).toBe(200);
    expect(res.body.reputacionActual).toBe(0);
    expect(res.body.estado_partida).toBe('GAME_OVER');
    expect((await leer()).estado_partida).toBe('GAME_OVER');
  });

  test('con GAME_OVER se bloquean compras, equipos, tickets e incidentes', async () => {
    const compra = await request(app).post('/api/tienda/comprar').set(auth(ctx.token)).send({ id_producto: 1 });
    expect(compra.status).toBe(409);
    expect(compra.body.codigo).toBe('GAME_OVER');

    const equipo = await request(app).post('/api/inventario/1/vender').set(auth(ctx.token));
    expect(equipo.status).toBe(409);
    expect(equipo.body.codigo).toBe('GAME_OVER');

    const demo = await request(app).post('/api/tickets/generar-demo').set(auth(ctx.token));
    expect(demo.status).toBe(409);

    const [[pendiente]] = await db.query(
      "SELECT id_ticket FROM Tickets_Soporte WHERE id_usuario = ? AND estado = 'pendiente' LIMIT 1", [ctx.id_alumno]);
    const acepta = await request(app).post(`/api/tickets/${pendiente.id_ticket}/aceptar`).set(auth(ctx.token));
    expect(acepta.status).toBe(409);
    expect(acepta.body.codigo).toBe('GAME_OVER');

    const incidente = await request(app).post('/api/eventos/generar').set(auth(ctx.token));
    expect(incidente.status).toBe(409);
  });

  test('el dashboard sigue respondiendo e informa GAME_OVER con estadísticas', async () => {
    const res = await request(app).get('/api/usuario/dashboard').set(auth(ctx.token));
    expect(res.status).toBe(200);
    expect(res.body.estado_partida).toBe('GAME_OVER');
    expect(res.body.estadisticas.contratos_finalizados).toBe(1);
  });

  test('POST /api/usuario/reset reinicia la partida', async () => {
    const res = await request(app).post('/api/usuario/reset').set(auth(ctx.token));

    expect(res.status).toBe(200);
    expect(res.body.estado_partida).toBe('ACTIVE');
    expect(res.body.metricas).toMatchObject({ creditos: 1000, reputacion: 50, espacio_usado: 0 });

    const pendientes = await request(app).get('/api/tickets/pendientes').set(auth(ctx.token));
    expect(pendientes.body).toHaveLength(0);

    const compra = await request(app).post('/api/tienda/comprar').set(auth(ctx.token)).send({ id_producto: 1 });
    expect(compra.status).toBe(200);
  });

  test('el reset no requiere estar en GAME_OVER y no afecta a otros alumnos', async () => {
    const [[otro]] = await db.query('SELECT COUNT(*) AS n FROM Usuarios WHERE id_usuario <> ?', [ctx.id_alumno]);
    const res = await request(app).post('/api/usuario/reset').set(auth(ctx.token));
    expect(res.status).toBe(200);
    const [[otroDespues]] = await db.query('SELECT COUNT(*) AS n FROM Usuarios WHERE id_usuario <> ?', [ctx.id_alumno]);
    expect(otroDespues.n).toBe(otro.n);
  });
});
