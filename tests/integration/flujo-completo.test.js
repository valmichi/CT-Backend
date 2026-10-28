// Pruebas de integración contra una base MySQL real (database/init.sql).
// Se ejecutan solo si RUN_INTEGRATION=true (en GitHub Actions lo activa el workflow).
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

// Imprime la respuesta real en el log de CI para documentar los bugs conocidos
const registrarRespuesta = (caso, res) => {
  console.log(`[${caso}] HTTP ${res.status} ${JSON.stringify(res.body)}`);
};

describeIntegracion('Flujo completo profesor -> clase -> estudiante -> tienda', () => {
  const sufijo = Date.now();
  const profesor = {
    nombre: 'Profesor CI',
    correo: `ci_${sufijo}@universidad.edu`,
    password: 'PasswordCI2026'
  };
  let tokenProfesor;
  let clase;
  let tokenEstudiante;

  afterAll(async () => {
    await db.end();
  });

  test('GET /api/health conecta con MySQL', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
  });

  test('registra un profesor con la clave maestra', async () => {
    const res = await request(app)
      .post('/api/profesor/registro')
      .send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });

    expect(res.status).toBe(201);
    expect(res.body.id_profesor).toBeDefined();
  });

  test('rechaza registrar el mismo correo dos veces', async () => {
    const res = await request(app)
      .post('/api/profesor/registro')
      .send({ ...profesor, clave_maestra: process.env.ADMIN_REGISTRATION_KEY });

    expect(res.status).toBe(400);
  });

  test('rechaza login con contraseña incorrecta', async () => {
    const res = await request(app)
      .post('/api/profesor/login')
      .send({ correo: profesor.correo, password: 'incorrecta' });

    expect(res.status).toBe(401);
  });

  test('inicia sesión como profesor y recibe JWT', async () => {
    const res = await request(app)
      .post('/api/profesor/login')
      .send({ correo: profesor.correo, password: profesor.password });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    tokenProfesor = res.body.token;
  });

  test('crea una clase con código CT-XXXXX', async () => {
    const res = await request(app)
      .post('/api/profesor/clases')
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombre_clase: 'Grupo CI' });

    expect(res.status).toBe(201);
    expect(res.body.codigo_clase).toMatch(/^CT-[A-Z2-9]{5}$/);
    clase = res.body;
  });

  test('lista las clases del profesor', async () => {
    const res = await request(app)
      .get('/api/profesor/clases')
      .set('Authorization', `Bearer ${tokenProfesor}`);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.id_clase)).toContain(clase.id_clase);
  });

  test('da de alta a un estudiante en la clase', async () => {
    const res = await request(app)
      .post(`/api/profesor/clases/${clase.id_clase}/estudiantes`)
      .set('Authorization', `Bearer ${tokenProfesor}`)
      .send({ nombreUsuario: 'alumno_ci' });

    expect(res.status).toBe(201);
  });

  test('rechaza un estudiante no registrado', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'intruso', codigo_clase: clase.codigo_clase });

    expect(res.status).toBe(403);
  });

  test('el estudiante inicia sesión con su código de clase', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: 'alumno_ci', codigo_clase: clase.codigo_clase.toLowerCase() });

    expect(res.status).toBe(200);
    expect(res.body.usuario.creditos).toBe(1000);
    tokenEstudiante = res.body.token;
  });

  test('el catálogo de la tienda devuelve los productos semilla', async () => {
    const res = await request(app).get('/api/tienda/catalogo');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(6);
  });

  // BUG CONOCIDO: mysql2 devuelve DECIMAL como string, y la validación
  // `user.creditos < prod.costo` compara "1000.00" < "250.00" como texto (true).
  // Resultado: responde 400 "Créditos insuficientes" aunque el alumno sí tiene saldo.
  // Cuando se corrija, cambiar test.failing por test.
  test.failing('el estudiante compra un servidor con saldo suficiente', async () => {
    const res = await request(app)
      .post('/api/tienda/comprar')
      .set('Authorization', `Bearer ${tokenEstudiante}`)
      .send({ id_producto: 1 });

    registrarRespuesta('B1 compra', res);
    expect(res.status).toBe(200);
    expect(Number(res.body.metricasActualizadas.creditos)).toBe(750);
  });

  // BUG CONOCIDO: la consulta usa `inventario_usuario` / `catalogo_productos` en minúsculas.
  // En MySQL sobre Linux los nombres de tabla distinguen mayúsculas, así que falla con 500.
  // En Windows pasa desapercibido. Cuando se corrija, cambiar test.failing por test.
  test.failing('el estudiante consulta su inventario', async () => {
    const res = await request(app)
      .get('/api/tienda/inventario')
      .set('Authorization', `Bearer ${tokenEstudiante}`);

    registrarRespuesta('B2 inventario', res);
    expect(res.status).toBe(200);
  });

  test('el profesor ve las métricas de sus alumnos', async () => {
    const res = await request(app)
      .get(`/api/profesor/clases/${clase.id_clase}/alumnos`)
      .set('Authorization', `Bearer ${tokenProfesor}`);

    expect(res.status).toBe(200);
    expect(res.body[0].nombreUsuario).toBe('alumno_ci');
  });

  // BUG CONOCIDO: la ruta promete borrar "en cascada", pero la FK
  // fk_usuarios_clases está definida como ON DELETE RESTRICT en init.sql,
  // así que borrar una clase con alumnos responde 500.
  test.failing('elimina una clase con alumnos (borrado en cascada)', async () => {
    const res = await request(app)
      .delete(`/api/profesor/clases/${clase.id_clase}`)
      .set('Authorization', `Bearer ${tokenProfesor}`);

    registrarRespuesta('B3 borrar clase', res);
    expect(res.status).toBe(200);
  });
});
