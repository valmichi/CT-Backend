// Validaciones del registro docente (sin base de datos: el pool se simula).
jest.mock('../../src/config/db', () => ({
  query: jest.fn(),
  getConnection: jest.fn()
}));

const request = require('supertest');
const db = require('../../src/config/db');
const app = require('../../src/app');
const v = require('../../src/utils/validacion');

beforeEach(() => db.query.mockReset());

describe('claveMaestraValida (comparación en tiempo constante)', () => {
  test('acepta solo la clave exacta', () => {
    expect(v.claveMaestraValida('clave-secreta', 'clave-secreta')).toBe(true);
    expect(v.claveMaestraValida('clave-secretA', 'clave-secreta')).toBe(false);
    expect(v.claveMaestraValida('corta', 'clave-secreta-larga')).toBe(false);
  });

  test('rechaza valores vacíos o que no son texto', () => {
    expect(v.claveMaestraValida(undefined, 'x')).toBe(false);
    expect(v.claveMaestraValida({ a: 1 }, 'x')).toBe(false);
    expect(v.claveMaestraValida('', '')).toBe(false); // sin clave configurada nadie se registra
  });
});

describe('correo y contraseña', () => {
  test('normaliza y valida el formato del correo', () => {
    expect(v.normalizarCorreo('  Profe@UNI.edu.MX ')).toBe('profe@uni.edu.mx');
    expect(v.correoValido('profe@uni.edu.mx')).toBe(true);
    expect(v.correoValido('profe@uni')).toBe(false);
    expect(v.correoValido('sin arroba.com')).toBe(false);
  });

  test('exige al menos 8 caracteres con letras y números', () => {
    expect(v.problemaPassword('Secreta123')).toBeNull();
    expect(v.problemaPassword('Ab1')).toMatch(/al menos 8/);
    expect(v.problemaPassword('soloLetrasAqui')).toMatch(/letras y números/);
    expect(v.problemaPassword('1234567890')).toMatch(/letras y números/);
    expect(v.problemaPassword('a1'.repeat(40))).toMatch(/más de 72/);
  });
});

describe('POST /api/profesor/registro con la clave correcta', () => {
  const base = { nombre: 'Profe Prueba', correo: 'profe@test.edu', password: 'Secreta123', clave_maestra: process.env.ADMIN_REGISTRATION_KEY };

  test('rechaza una contraseña débil sin tocar la base de datos', async () => {
    const res = await request(app).post('/api/profesor/registro').send({ ...base, password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/al menos 8/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('rechaza un correo con formato inválido', async () => {
    const res = await request(app).post('/api/profesor/registro').send({ ...base, correo: 'no-es-correo' });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('con clave incorrecta responde 403 sin decir nada de la contraseña', async () => {
    const res = await request(app).post('/api/profesor/registro').send({ ...base, password: 'abc', clave_maestra: 'mala' });
    expect(res.status).toBe(403);
  });
});
