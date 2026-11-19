// Límite de intentos en los endpoints de acceso (express-rate-limit).
// Cada prueba carga una instancia nueva de la app para empezar con contadores en cero.
jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn()
}));

const request = require('supertest');

const cargarApp = (trustProxy) => {
  let app;
  if (trustProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = trustProxy;
  }
  jest.isolateModules(() => {
    app = require('../../src/app');
  });
  return app;
};

// Cuerpo vacío: la ruta responde 400 sin tocar la base, pero el intento cuenta
const intentarLogin = (app, ip) => {
  const req = request(app).post('/api/auth/login').send({});
  return ip ? req.set('X-Forwarded-For', ip) : req;
};

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe('Límite de intentos de login', () => {
  test('el intento 16 desde la misma IP responde 429', async () => {
    const app = cargarApp();

    for (let i = 0; i < 15; i++) {
      const res = await intentarLogin(app);
      expect(res.status).toBe(400);
    }
    const bloqueado = await intentarLogin(app);

    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.error).toMatch(/Demasiados intentos/);
  });

  test('con TRUST_PROXY=1 cada jugador detrás del túnel tiene su propio límite', async () => {
    const app = cargarApp('1');

    for (let i = 0; i < 15; i++) {
      await intentarLogin(app, '203.0.113.10');
    }
    const jugador1 = await intentarLogin(app, '203.0.113.10');
    const jugador2 = await intentarLogin(app, '198.51.100.20');

    expect(jugador1.status).toBe(429);
    expect(jugador2.status).toBe(400);
  });
});
