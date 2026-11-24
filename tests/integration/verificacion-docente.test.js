// Registro docente con dominio institucional y código de verificación por correo.
// Se ejecuta solo si RUN_INTEGRATION=true. Usa EMAIL_MODO_CONSOLA para leer el
// código "enviado" sin un servidor SMTP real. Ojo: registro, login, verificar y
// reenviar comparten el límite de 15 intentos por 15 minutos (app.js), así que
// esta prueba hace menos de 15 de esas peticiones.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const correoSvc = require('../../src/services/correo.service');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

describeIntegracion('Verificación del correo de docentes', () => {
  const sufijo = Date.now();
  const clave_maestra = process.env.ADMIN_REGISTRATION_KEY;
  const envAntes = {};
  const VARIABLES = ['DOCENTES_VERIFICAR_CORREO', 'EMAIL_MODO_CONSOLA', 'DOCENTES_DOMINIOS'];

  const docente = { nombre: 'Profe Verifica', correo: `verifica_${sufijo}@escuela.universidad.edu`, password: 'Verifica2026' };
  const codigoEnviado = () => (correoSvc.ultimoEnviado().texto.match(/\b(\d{6})\b/) || [])[1];

  beforeAll(() => {
    for (const v of VARIABLES) envAntes[v] = process.env[v];
    process.env.DOCENTES_VERIFICAR_CORREO = 'true';
    process.env.EMAIL_MODO_CONSOLA = 'true';
    process.env.DOCENTES_DOMINIOS = 'universidad.edu';
    jest.spyOn(console, 'log').mockImplementation(() => {}); // el modo consola imprime el correo
  });

  afterAll(async () => {
    for (const v of VARIABLES) {
      if (envAntes[v] === undefined) delete process.env[v];
      else process.env[v] = envAntes[v];
    }
    console.log.mockRestore();
    await db.end();
  });

  test('rechaza correos fuera del dominio institucional', async () => {
    const res = await request(app).post('/api/profesor/registro')
      .send({ ...docente, correo: `otro_${sufijo}@gmail.com`, clave_maestra });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('DOMINIO_NO_PERMITIDO');
  });

  test('registra la cuenta pendiente y envía un código de 6 dígitos (subdominios permitidos)', async () => {
    const res = await request(app).post('/api/profesor/registro').send({ ...docente, clave_maestra });
    expect(res.status).toBe(201);
    expect(res.body.requiere_verificacion).toBe(true);
    expect(correoSvc.ultimoEnviado().para).toBe(docente.correo);
    expect(codigoEnviado()).toMatch(/^\d{6}$/);
  });

  test('no deja iniciar sesión sin verificar (aunque la contraseña sea correcta)', async () => {
    const res = await request(app).post('/api/profesor/login').send({ correo: docente.correo, password: docente.password });
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('CORREO_NO_VERIFICADO');
  });

  test('un registro pendiente no se puede duplicar', async () => {
    const res = await request(app).post('/api/profesor/registro').send({ ...docente, clave_maestra });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('VERIFICACION_PENDIENTE');
  });

  test('un código incorrecto descuenta intentos y no se puede reenviar enseguida', async () => {
    const correcto = codigoEnviado();
    const incorrecto = correcto === '000000' ? '111111' : '000000';
    const res = await request(app).post('/api/profesor/verificar').send({ correo: docente.correo, codigo: incorrecto });
    expect(res.status).toBe(400);
    expect(res.body.intentos_restantes).toBe(4);

    const reenvio = await request(app).post('/api/profesor/reenviar-codigo').send({ correo: docente.correo });
    expect(reenvio.status).toBe(429);
    expect(reenvio.body.codigo).toBe('ESPERA_REENVIO');
  });

  test('reenviar genera un código nuevo e invalida el anterior', async () => {
    const viejo = codigoEnviado();
    await db.query('UPDATE Profesores SET codigo_enviado = NOW() - INTERVAL 2 MINUTE WHERE correo = ?', [docente.correo]);
    const reenvio = await request(app).post('/api/profesor/reenviar-codigo').send({ correo: docente.correo });
    expect(reenvio.status).toBe(200);
    const nuevo = codigoEnviado();
    expect(nuevo).toMatch(/^\d{6}$/);

    if (nuevo !== viejo) {
      const conViejo = await request(app).post('/api/profesor/verificar').send({ correo: docente.correo, codigo: viejo });
      expect(conViejo.status).toBe(400);
    }
    const ok = await request(app).post('/api/profesor/verificar').send({ correo: docente.correo, codigo: nuevo });
    expect(ok.status).toBe(200);
  });

  test('ya verificado puede iniciar sesión', async () => {
    const res = await request(app).post('/api/profesor/login').send({ correo: docente.correo, password: docente.password });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('un código vencido o con demasiados intentos ya no sirve', async () => {
    const otro = { ...docente, correo: `vence_${sufijo}@universidad.edu` };
    expect((await request(app).post('/api/profesor/registro').send({ ...otro, clave_maestra })).status).toBe(201);
    const codigo = codigoEnviado();

    await db.query('UPDATE Profesores SET codigo_intentos = 5 WHERE correo = ?', [otro.correo]);
    const bloqueado = await request(app).post('/api/profesor/verificar').send({ correo: otro.correo, codigo });
    expect(bloqueado.status).toBe(429);

    await db.query('UPDATE Profesores SET codigo_intentos = 0, codigo_expira = NOW() - INTERVAL 1 MINUTE WHERE correo = ?', [otro.correo]);
    const vencido = await request(app).post('/api/profesor/verificar').send({ correo: otro.correo, codigo });
    expect(vencido.status).toBe(410);
    expect(vencido.body.codigo).toBe('CODIGO_EXPIRADO');
  });

  test('sin forma de enviar correos no crea la cuenta (503)', async () => {
    process.env.EMAIL_MODO_CONSOLA = 'false';
    const correo = `sinsmtp_${sufijo}@universidad.edu`;
    const res = await request(app).post('/api/profesor/registro').send({ ...docente, correo, clave_maestra });
    process.env.EMAIL_MODO_CONSOLA = 'true';
    expect(res.status).toBe(503);
    expect(res.body.codigo).toBe('EMAIL_NO_CONFIGURADO');
    const [filas] = await db.query('SELECT id_profesor FROM Profesores WHERE correo = ?', [correo]);
    expect(filas).toHaveLength(0);
  });
});
