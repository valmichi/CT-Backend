// Baja de la cuenta del docente: confirma con contraseña y borra en cascada sus
// clases, alumnos y partidas, sin tocar a otros docentes.
// Se ejecuta solo si RUN_INTEGRATION=true. (Hace menos de 15 peticiones al
// limitador estricto de autenticación.)
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describeIntegracion('Baja de la cuenta del docente', () => {
  const sufijo = Date.now();
  const ctx = {};

  const crearDocente = async (etiqueta) => {
    const datos = { nombre: `Profe ${etiqueta}`, correo: `baja_${etiqueta}_${sufijo}@universidad.edu`, password: 'BajaCuenta2026' };
    await request(app).post('/api/profesor/registro').send({ ...datos, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });
    const login = await request(app).post('/api/profesor/login').send({ correo: datos.correo, password: datos.password });
    const clase = await request(app).post('/api/profesor/clases').set(auth(login.body.token)).send({ nombre_clase: `Grupo ${etiqueta}` });
    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(login.body.token))
      .send({ nombreUsuario: `alumno_${etiqueta}` });
    return { ...datos, token: login.body.token, id_clase: clase.body.id_clase, codigo: clase.body.codigo_clase, id_alumno: alta.body.id_usuario };
  };

  const contar = async (tabla, columna, valor) => {
    const [[fila]] = await db.query(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${columna} = ?`, [valor]);
    return Number(fila.n);
  };

  beforeAll(async () => {
    ctx.A = await crearDocente('A');
    ctx.B = await crearDocente('B');
    // El alumno de A juega un poco: entra y compra, así tiene inventario e historial.
    const alumno = await request(app).post('/api/auth/login').send({ nombreUsuario: 'alumno_A', codigo_clase: ctx.A.codigo });
    await request(app).post('/api/tienda/comprar').set(auth(alumno.body.token)).send({ id_producto: 1 });
  });

  afterAll(async () => {
    await db.end();
  });

  test('sin contraseña o con una incorrecta no borra nada (400, la sesión sigue)', async () => {
    const sin = await request(app).delete('/api/profesor/cuenta').set(auth(ctx.A.token)).send({});
    expect(sin.status).toBe(400);

    const mala = await request(app).delete('/api/profesor/cuenta').set(auth(ctx.A.token)).send({ password: 'Equivocada123' });
    expect(mala.status).toBe(400);
    expect(mala.body.codigo).toBe('PASSWORD_INCORRECTA');
    expect(await contar('Clases', 'id_clase', ctx.A.id_clase)).toBe(1);
  });

  test('con la contraseña correcta borra la cuenta, sus clases, alumnos y partidas', async () => {
    expect(await contar('Inventario_Usuario', 'id_usuario', ctx.A.id_alumno)).toBe(1);

    const res = await request(app).delete('/api/profesor/cuenta').set(auth(ctx.A.token)).send({ password: ctx.A.password });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ clases_eliminadas: 1, alumnos_eliminados: 1 });

    expect(await contar('Profesores', 'correo', ctx.A.correo)).toBe(0);
    expect(await contar('Clases', 'id_clase', ctx.A.id_clase)).toBe(0);
    expect(await contar('Usuarios', 'id_usuario', ctx.A.id_alumno)).toBe(0);
    expect(await contar('Inventario_Usuario', 'id_usuario', ctx.A.id_alumno)).toBe(0);
    expect(await contar('Historial_Actividad', 'id_usuario', ctx.A.id_alumno)).toBe(0);
  });

  test('después ya no puede iniciar sesión ni su alumno entrar al juego', async () => {
    const login = await request(app).post('/api/profesor/login').send({ correo: ctx.A.correo, password: ctx.A.password });
    expect(login.status).toBe(401);

    const alumno = await request(app).post('/api/auth/login').send({ nombreUsuario: 'alumno_A', codigo_clase: ctx.A.codigo });
    expect(alumno.status).toBe(404); // el código de clase ya no existe
  });

  test('el otro docente y su clase siguen intactos', async () => {
    expect(await contar('Clases', 'id_clase', ctx.B.id_clase)).toBe(1);
    expect(await contar('Usuarios', 'id_usuario', ctx.B.id_alumno)).toBe(1);
    const res = await request(app).get('/api/profesor/clases').set(auth(ctx.B.token));
    expect(res.status).toBe(200);
  });
});
