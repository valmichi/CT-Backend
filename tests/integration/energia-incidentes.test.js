// Energía con unidades reales (INSUFFICIENT_POWER / POWER_IN_USE), incidentes
// generados por el servidor y apagón parcial (brownout).
// Se ejecuta solo si RUN_INTEGRATION=true, igual que las demás de integración.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Productos del catálogo semilla (init.sql)
const DULL_R110 = 1;          // servidor 1U, 120 W
const HYPERMICRO_X12 = 4;     // servidor 3U, 650 W, +24 °C
const APAGON_UPS = 12;        // energía 2U, +800 W de capacidad, 20 W

describeIntegracion('Energía, incidentes y apagón parcial', () => {
  const sufijo = Date.now();

  const crearAlumno = async (etiqueta) => {
    const profesor = { nombre: `Profe ${etiqueta}`, correo: `ei_${etiqueta}_${sufijo}@universidad.edu`, password: 'PasswordEnergia2026' };
    await request(app).post('/api/profesor/registro').send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });
    const login = await request(app).post('/api/profesor/login').send({ correo: profesor.correo, password: profesor.password });
    const clase = await request(app).post('/api/profesor/clases').set(auth(login.body.token)).send({ nombre_clase: `Grupo ${etiqueta}` });
    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(login.body.token))
      .send({ nombreUsuario: `alumno_${etiqueta}` });
    const alumno = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: `alumno_${etiqueta}`, codigo_clase: clase.body.codigo_clase });
    return { id: alta.body.id_usuario, token: alumno.body.token };
  };

  const comprar = (a, id_producto) =>
    request(app).post('/api/tienda/comprar').set(auth(a.token)).send({ id_producto });
  const cambiar = (a, id, encendido) =>
    request(app).post(`/api/inventario/${id}/estado`).set(auth(a.token)).send({ encendido });

  afterAll(async () => {
    await db.end();
  });

  describe('Energía con unidades reales', () => {
    const a = {};
    beforeAll(async () => {
      Object.assign(a, await crearAlumno('energia'));
      await db.query('UPDATE Usuarios SET creditos = 20000 WHERE id_usuario = ?', [a.id]);
    });

    test('un servidor que no cabe en la capacidad se compra pero queda apagado', async () => {
      const uno = await comprar(a, HYPERMICRO_X12); // 250 + 650 = 900 W <= 1000 W
      expect(uno.status).toBe(200);
      expect(uno.body.encendido).toBe(true);
      a.x12a = uno.body.id_inventario;

      const dos = await comprar(a, HYPERMICRO_X12); // 900 + 650 = 1550 W > 1000 W
      expect(dos.status).toBe(200);
      expect(dos.body.encendido).toBe(false);
      expect(dos.body.aviso).toBe('INSUFFICIENT_POWER');
      a.x12b = dos.body.id_inventario;
    });

    test('encenderlo sin energía suficiente responde 409 INSUFFICIENT_POWER', async () => {
      const res = await cambiar(a, a.x12b, true);
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('INSUFFICIENT_POWER');
    });

    test('con una unidad de energía ya se puede encender', async () => {
      const ups = await comprar(a, APAGON_UPS); // capacidad 1800 W
      expect(ups.status).toBe(200);
      expect(ups.body.encendido).toBe(true);
      a.ups = ups.body.id_inventario;

      const res = await cambiar(a, a.x12b, true); // 920 + 650 = 1570 W <= 1800 W
      expect(res.status).toBe(200);
      expect(res.body.estado.metricas.capacidad_watts).toBe(1800);
    });

    test('apagar o vender la unidad de energía en uso responde 409 POWER_IN_USE', async () => {
      const apagar = await cambiar(a, a.ups, false);
      expect(apagar.status).toBe(409);
      expect(apagar.body.codigo).toBe('POWER_IN_USE');

      const vender = await request(app).post(`/api/inventario/${a.ups}/vender`).set(auth(a.token));
      expect(vender.status).toBe(409);
      expect(vender.body.codigo).toBe('POWER_IN_USE');
    });

    test('al apagar el servidor extra la unidad de energía ya se puede apagar', async () => {
      expect((await cambiar(a, a.x12b, false)).status).toBe(200);
      const res = await cambiar(a, a.ups, false); // 900 W <= 1000 W
      expect(res.status).toBe(200);
    });
  });

  describe('Incidentes y apagón parcial', () => {
    const b = {};
    beforeAll(async () => {
      Object.assign(b, await crearAlumno('incidentes'));
      // 3 servidores de 120 W: 250 + 360 = 610 W (cabe en 1000 W, no en 600 W)
      b.servidores = [];
      for (let i = 0; i < 3; i++) b.servidores.push((await comprar(b, DULL_R110)).body.id_inventario);
    });

    test('la falla eléctrica baja la capacidad y apaga el último servidor instalado', async () => {
      const res = await request(app).post('/api/eventos/generar').set(auth(b.token)).send({ tipo: 'FALLA_ELECTRICA' });
      expect(res.status).toBe(201);
      expect(res.body.incidente.accion_requerida).toBeUndefined();
      expect(res.body.incidente.opciones.length).toBeGreaterThanOrEqual(2);
      expect(res.body.estado.metricas.falla_electrica).toBe(true);
      expect(res.body.estado.metricas.capacidad_watts).toBe(600);

      const apagon = res.body.eventos.find((e) => e.tipo === 'APAGON_PARCIAL');
      expect(apagon.equipos.map((e) => e.id_inventario)).toEqual([b.servidores[2]]);
      b.incidente = res.body.incidente.id_incidente;
    });

    test('durante la falla no se puede reencender el servidor apagado', async () => {
      const res = await cambiar(b, b.servidores[2], true);
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('INSUFFICIENT_POWER');
    });

    test('el dashboard muestra el incidente activo con sus opciones, sin la respuesta', async () => {
      const res = await request(app).get('/api/usuario/dashboard').set(auth(b.token));
      expect(res.body.incidente.id_incidente).toBe(b.incidente);
      expect(res.body.incidente.accion_requerida).toBeUndefined();
      expect(res.body.incidente.segundos_restantes).toBeGreaterThan(0);
      const rack = res.body.racks[0].equipos.find((e) => e.id_inventario === b.servidores[2]);
      expect(rack.sin_energia).toBe(true);
    });

    test('la acción correcta resuelve la falla y la energía vuelve', async () => {
      const res = await request(app)
        .post('/api/eventos/resolver')
        .set(auth(b.token))
        .send({ id_incidente: b.incidente, accion_ejecutada: 'CAMBIAR_ENERGIA_RESPALDO' });
      expect(res.status).toBe(200);
      expect(res.body.exito).toBe(true);
      expect(res.body.estado.metricas.falla_electrica).toBe(false);
      expect(res.body.estado.metricas.capacidad_watts).toBe(1000);

      const encender = await cambiar(b, b.servidores[2], true);
      expect(encender.status).toBe(200);
    });

    test('un incidente sin respuesta a tiempo cuenta como fallido y quita 8 de reputación', async () => {
      const gen = await request(app).post('/api/eventos/generar').set(auth(b.token)).send({ tipo: 'SATURACION_RED' });
      await db.query('UPDATE Incidentes_Activos SET fecha_limite = NOW() - INTERVAL 1 SECOND WHERE id_incidente = ?', [gen.body.incidente.id_incidente]);
      const [[antes]] = await db.query('SELECT reputacion FROM Usuarios WHERE id_usuario = ?', [b.id]);

      const res = await request(app).get('/api/usuario/dashboard').set(auth(b.token));
      const ev = res.body.eventos.find((e) => e.tipo === 'INCIDENTE_FALLIDO');
      expect(ev.motivo).toBe('EXPIRADO');
      expect(res.body.incidente).toBeNull();
      const [[despues]] = await db.query('SELECT reputacion FROM Usuarios WHERE id_usuario = ?', [b.id]);
      expect(despues.reputacion).toBe(Math.max(0, antes.reputacion - 8));
    });

    test('cuando toca, el servidor genera el siguiente incidente solo', async () => {
      await db.query('UPDATE Usuarios SET proximo_incidente = NOW() - INTERVAL 1 SECOND WHERE id_usuario = ?', [b.id]);
      const res = await request(app).get('/api/usuario/dashboard').set(auth(b.token));
      expect(res.body.eventos.some((e) => e.tipo === 'INCIDENTE')).toBe(true);
      expect(res.body.incidente).not.toBeNull();
    });
  });
});
