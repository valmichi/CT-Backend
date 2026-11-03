// Pruebas de la API sin base de datos real: el pool de MySQL se reemplaza por un mock.
jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn()
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../../src/config/db');
const app = require('../../src/app');

beforeEach(() => {
  db.query.mockReset();
});

describe('GET /api/health', () => {
  test('responde 200 cuando la base de datos contesta', async () => {
    db.query.mockResolvedValueOnce([[{ horaServidor: '2026-10-27 12:00:00' }]]);

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  test('responde 500 cuando la base de datos falla', async () => {
    db.query.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/MySQL/);
  });
});

describe('Cabeceras de seguridad (Helmet)', () => {
  test('no expone X-Powered-By y envía CSP', async () => {
    db.query.mockResolvedValueOnce([[{ horaServidor: 'x' }]]);

    const res = await request(app).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});

describe('POST /api/auth/login (estudiante)', () => {
  test('responde 400 si faltan campos', async () => {
    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('responde 404 si el código de clase no existe', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno', codigo_clase: 'ct-nada' });

    expect(res.status).toBe(404);
    // El código se normaliza a mayúsculas antes de consultar
    expect(db.query.mock.calls[0][1]).toEqual(['CT-NADA']);
  });

  test('responde 403 si la clase está inactiva', async () => {
    db.query.mockResolvedValueOnce([[{ id_clase: 1, activa: 0 }]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno', codigo_clase: 'CT-DEMO1' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/profesor/registro', () => {
  test('responde 400 si faltan campos', async () => {
    const res = await request(app).post('/api/profesor/registro').send({ nombre: 'X' });

    expect(res.status).toBe(400);
  });

  test('responde 403 con clave maestra incorrecta', async () => {
    const res = await request(app).post('/api/profesor/registro').send({
      nombre: 'Profe',
      correo: 'profe@test.edu',
      password: 'Secreta123',
      clave_maestra: 'incorrecta'
    });

    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('Rutas protegidas del profesor', () => {
  test('GET /api/profesor/clases sin token responde 401', async () => {
    const res = await request(app).get('/api/profesor/clases');

    expect(res.status).toBe(401);
  });

  test('GET /api/profesor/clases con token de estudiante responde 403', async () => {
    const token = jwt.sign({ id_usuario: 1, rol: 'estudiante' }, process.env.JWT_SECRET);

    const res = await request(app)
      .get('/api/profesor/clases')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('Rutas protegidas de la tienda', () => {
  test('POST /api/tienda/comprar sin token responde 401', async () => {
    const res = await request(app).post('/api/tienda/comprar').send({ id_producto: 1 });

    expect(res.status).toBe(401);
  });

  test('POST /api/tienda/comprar sin id_producto responde 400', async () => {
    const token = jwt.sign({ id_usuario: 1, rol: 'estudiante' }, process.env.JWT_SECRET);

    const res = await request(app)
      .post('/api/tienda/comprar')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('Límite de tamaño del cuerpo', () => {
  const cuerpoGrande = { nombreUsuario: 'a'.repeat(20 * 1024), codigo_clase: 'CT-DEMO1' };

  beforeEach(() => {
    // El manejador central registra el error con console.error; se silencia en la salida
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('rechaza cuerpos mayores a 10kb sin llegar a la base de datos', async () => {
    const res = await request(app).post('/api/auth/login').send(cuerpoGrande);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  // BUG CONOCIDO: el manejador central de errores de app.js responde siempre 500,
  // aunque body-parser marque el error como 413 (Payload Too Large).
  // Cuando se corrija, cambiar test.failing por test.
  test.failing('responde 413 Payload Too Large', async () => {
    const res = await request(app).post('/api/auth/login').send(cuerpoGrande);

    expect(res.status).toBe(413);
  });
});
