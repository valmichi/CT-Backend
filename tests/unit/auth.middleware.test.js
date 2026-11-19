const jwt = require('jsonwebtoken');
const {
  autenticarToken,
  requerirProfesor,
  requerirDocente,
  requerirEstudiante
} = require('../../src/middlewares/auth.middleware');

// Simula el objeto res de Express
const crearRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Middleware autenticarToken', () => {
  test('responde 401 si no se envía token', () => {
    const req = { headers: {} };
    const res = crearRes();
    const next = jest.fn();

    autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('responde 403 si el token es inválido', () => {
    const req = { headers: { authorization: 'Bearer token_falso' } };
    const res = crearRes();
    const next = jest.fn();

    autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('responde 403 si el token está firmado con otra clave', () => {
    const token = jwt.sign({ id_usuario: 1 }, 'otra_clave');
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = crearRes();
    const next = jest.fn();

    autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('responde 403 si el token expiró', () => {
    const token = jwt.sign({ id_usuario: 1 }, process.env.JWT_SECRET, { expiresIn: -10 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = crearRes();
    const next = jest.fn();

    autenticarToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('llama a next() y expone el payload con un token válido', () => {
    const token = jwt.sign({ id_usuario: 7, rol: 'estudiante' }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = crearRes();
    const next = jest.fn();

    autenticarToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.usuario).toMatchObject({ id_usuario: 7, rol: 'estudiante' });
  });
});

describe('Middleware requerirProfesor', () => {
  test('responde 403 si el usuario no es profesor', () => {
    const req = { usuario: { rol: 'estudiante' } };
    const res = crearRes();
    const next = jest.fn();

    requerirProfesor(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('llama a next() si el usuario es profesor', () => {
    const req = { usuario: { rol: 'profesor' } };
    const res = crearRes();
    const next = jest.fn();

    requerirProfesor(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('Middleware requerirDocente', () => {
  test.each([
    ['sin usuario', undefined],
    ['token de alumno', { id_usuario: 1, rol: 'estudiante' }],
    ['alumno con rol admin pero sin id_profesor', { id_usuario: 1, rol: 'admin' }]
  ])('responde 403 con %s', (_caso, usuario) => {
    const res = crearRes();
    const next = jest.fn();

    requerirDocente({ usuario }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('llama a next() con un token emitido por /api/profesor/login', () => {
    const next = jest.fn();

    requerirDocente({ usuario: { id_profesor: 7, rol: 'admin' } }, crearRes(), next);

    expect(next).toHaveBeenCalled();
  });
});

describe('Middleware requerirEstudiante', () => {
  test.each([
    ['sin usuario', undefined],
    ['token de profesor', { id_profesor: 7, rol: 'admin' }]
  ])('responde 403 con %s', (_caso, usuario) => {
    const res = crearRes();
    const next = jest.fn();

    requerirEstudiante({ usuario }, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('llama a next() con un token de alumno', () => {
    const next = jest.fn();

    requerirEstudiante({ usuario: { id_usuario: 3, rol: 'estudiante' } }, crearRes(), next);

    expect(next).toHaveBeenCalled();
  });
});
