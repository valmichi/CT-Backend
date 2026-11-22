// Pruebas de integración de la lógica del juego (tickets, incidentes, estado del
// jugador, compras concurrentes) y de autorización entre usuarios (IDOR).
// Se ejecutan solo si RUN_INTEGRATION=true, igual que flujo-completo.test.js.
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');

const describeIntegracion = process.env.RUN_INTEGRATION === 'true' ? describe : describe.skip;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Lee las métricas del alumno directo de la base para comparar contra la API
const leerAlumno = async (id_usuario) => {
  const [rows] = await db.query(
    'SELECT creditos, reputacion, contratos_finalizados, ataquesResueltos FROM Usuarios WHERE id_usuario = ?',
    [id_usuario]
  );
  const u = rows[0];
  return {
    creditos: Number(u.creditos),
    reputacion: Number(u.reputacion),
    contratos_finalizados: Number(u.contratos_finalizados),
    ataquesResueltos: Number(u.ataquesResueltos)
  };
};

describeIntegracion('Seguridad entre usuarios y lógica del juego', () => {
  const sufijo = Date.now();
  const clave_maestra = process.env.ADMIN_REGISTRATION_KEY;

  // Profesor A con alumno A; Profesor B con alumno B (el "otro" usuario)
  const ctx = {};

  const crearProfesorConAlumno = async (etiqueta) => {
    const profesor = {
      nombre: `Profesor ${etiqueta}`,
      correo: `seg_${etiqueta}_${sufijo}@universidad.edu`,
      password: `Password${etiqueta}2026`
    };
    await request(app).post('/api/profesor/registro').send({ ...profesor, clave_maestra });
    const login = await request(app)
      .post('/api/profesor/login')
      .send({ correo: profesor.correo, password: profesor.password });
    const token = login.body.token;

    const clase = await request(app)
      .post('/api/profesor/clases')
      .set(auth(token))
      .send({ nombre_clase: `Grupo ${etiqueta}` });

    const alta = await request(app)
      .post(`/api/profesor/clases/${clase.body.id_clase}/estudiantes`)
      .set(auth(token))
      .send({ nombreUsuario: `alumno_${etiqueta}` });

    const loginAlumno = await request(app)
      .post('/api/auth/login')
      .send({ nombreUsuario: `alumno_${etiqueta}`, codigo_clase: clase.body.codigo_clase });

    return {
      tokenProfesor: token,
      clase: clase.body,
      id_alumno: alta.body.id_usuario,
      tokenAlumno: loginAlumno.body.token
    };
  };

  beforeAll(async () => {
    ctx.A = await crearProfesorConAlumno('A');
    ctx.B = await crearProfesorConAlumno('B');
  });

  afterAll(async () => {
    await db.end();
  });

  test('la preparación crea dos profesores, dos clases y dos alumnos', () => {
    for (const k of ['A', 'B']) {
      expect(ctx[k].tokenProfesor).toBeDefined();
      expect(ctx[k].clase.id_clase).toBeDefined();
      expect(ctx[k].id_alumno).toBeDefined();
      expect(ctx[k].tokenAlumno).toBeDefined();
    }
  });

  // ------------------------------------------------------------------
  // Métricas del dashboard docente
  // ------------------------------------------------------------------
  describe('GET /api/admin/metricas-alumnos', () => {
    test('sin token responde 401', async () => {
      const res = await request(app).get('/api/admin/metricas-alumnos');
      expect(res.status).toBe(401);
    });

    test('con token de alumno responde 403', async () => {
      const res = await request(app).get('/api/admin/metricas-alumnos').set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(403);
    });

    test('el profesor solo ve a los alumnos de sus propias clases', async () => {
      const res = await request(app).get('/api/admin/metricas-alumnos').set(auth(ctx.A.tokenProfesor));
      expect(res.status).toBe(200);
      const ids = res.body.map((a) => a.id_usuario);
      expect(ids).toContain(ctx.A.id_alumno);
      expect(ids).not.toContain(ctx.B.id_alumno);
    });
  });

  // ------------------------------------------------------------------
  // Autorización entre profesores (IDOR)
  // ------------------------------------------------------------------
  describe('Un profesor no puede operar sobre la clase de otro', () => {
    test('no ve los alumnos de la clase ajena', async () => {
      const res = await request(app)
        .get(`/api/profesor/clases/${ctx.B.clase.id_clase}/alumnos`)
        .set(auth(ctx.A.tokenProfesor));
      expect(res.status).toBe(403);
    });

    test('no puede dar de alta alumnos en la clase ajena', async () => {
      const res = await request(app)
        .post(`/api/profesor/clases/${ctx.B.clase.id_clase}/estudiantes`)
        .set(auth(ctx.A.tokenProfesor))
        .send({ nombreUsuario: 'infiltrado' });
      expect(res.status).toBe(403);
    });

    test('no puede borrar al alumno de otro profesor', async () => {
      const res = await request(app)
        .delete(`/api/profesor/estudiantes/${ctx.B.id_alumno}`)
        .set(auth(ctx.A.tokenProfesor));
      expect(res.status).toBe(403);
    });

    test('no puede borrar la clase ajena', async () => {
      const res = await request(app)
        .delete(`/api/profesor/clases/${ctx.B.clase.id_clase}`)
        .set(auth(ctx.A.tokenProfesor));
      expect(res.status).toBe(403);

      // La clase y su alumno siguen existiendo
      const alumnos = await request(app)
        .get(`/api/profesor/clases/${ctx.B.clase.id_clase}/alumnos`)
        .set(auth(ctx.B.tokenProfesor));
      expect(alumnos.status).toBe(200);
      expect(alumnos.body.map((a) => a.id_usuario)).toContain(ctx.B.id_alumno);
    });
  });

  // ------------------------------------------------------------------
  // Rutas de jugador con un token que no es de alumno
  // ------------------------------------------------------------------
  describe('Las rutas del jugador exigen token de alumno', () => {
    test.each([
      ['get', '/api/jugador/estado'],
      ['get', '/api/tickets/pendientes'],
      ['post', '/api/tickets/generar-demo'],
      ['get', '/api/eventos/activos'],
      ['post', '/api/eventos/generar'],
      ['get', '/api/tienda/inventario']
    ])('%s %s con token de profesor responde 403', async (metodo, ruta) => {
      const res = await request(app)[metodo](ruta).set(auth(ctx.A.tokenProfesor));
      expect(res.status).toBe(403);
    });
  });

  // ------------------------------------------------------------------
  // Estado del jugador
  // ------------------------------------------------------------------
  describe('GET /api/jugador/estado', () => {
    test('devuelve los datos del alumno dueño del token', async () => {
      const res = await request(app).get('/api/jugador/estado').set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(200);
      expect(res.body.usuario.id_usuario).toBe(ctx.A.id_alumno);
      expect(res.body.usuario.nombreUsuario).toBe('alumno_A');
      expect(Array.isArray(res.body.inventario)).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // Tickets (contratos con clientes)
  // ------------------------------------------------------------------
  describe('Tickets de soporte', () => {
    let tickets;

    test('genera los tickets demo del alumno', async () => {
      const res = await request(app).post('/api/tickets/generar-demo').set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(200);
    });

    test('lista solo los tickets pendientes del alumno', async () => {
      const res = await request(app).get('/api/tickets/pendientes').set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      expect(res.body.every((t) => t.id_usuario === ctx.A.id_alumno)).toBe(true);
      tickets = Object.fromEntries(res.body.map((t) => [t.descripcion, t]));

      const otro = await request(app).get('/api/tickets/pendientes').set(auth(ctx.B.tokenAlumno));
      expect(otro.body).toHaveLength(0);
    });

    test('rechaza resolver sin id_ticket', async () => {
      const res = await request(app).post('/api/tickets/resolver').set(auth(ctx.A.tokenAlumno)).send({});
      expect(res.status).toBe(400);
    });

    test('un alumno no puede resolver el ticket de otro', async () => {
      const res = await request(app)
        .post('/api/tickets/resolver')
        .set(auth(ctx.B.tokenAlumno))
        .send({ id_ticket: tickets['Hospedaje Web PYME'].id_ticket });
      expect(res.status).toBe(404);
    });

    // Ciclo de vida: pendiente -> aceptar (reserva) -> entrega -> completado/fallido.
    // Para no esperar 2 minutos reales, la prueba adelanta fecha_entrega en la base.
    const forzarEntrega = (id_ticket) =>
      db.query('UPDATE Tickets_Soporte SET fecha_entrega = NOW() - INTERVAL 1 SECOND WHERE id_ticket = ?', [id_ticket]);

    test('no se puede resolver un ticket sin aceptarlo primero', async () => {
      const res = await request(app)
        .post('/api/tickets/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_ticket: tickets['Hospedaje Web PYME'].id_ticket });
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('NOT_ACCEPTED');
    });

    test('sin capacidad libre suficiente no se puede aceptar (409 INSUFFICIENT_RESOURCES)', async () => {
      const ticket = tickets['Procesamiento IA / ML']; // pide 30 TFLOPS; el alumno tiene 10
      const res = await request(app).post(`/api/tickets/${ticket.id_ticket}/aceptar`).set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(409);
      expect(res.body.codigo).toBe('INSUFFICIENT_RESOURCES');
    });

    test('con capacidad suficiente se acepta, reserva capacidad y al entregarse suma la recompensa', async () => {
      // Un servidor Blade (+8 TFLOPS) deja al alumno en 18 TFLOPS, suficiente para 12
      const compra = await request(app)
        .post('/api/tienda/comprar')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_producto: 1 });
      expect(compra.status).toBe(200);
      ctx.A.id_servidor = compra.body.id_inventario;

      const ticket = tickets['Hospedaje Web PYME'];
      const acepta = await request(app).post(`/api/tickets/${ticket.id_ticket}/aceptar`).set(auth(ctx.A.tokenAlumno));
      expect(acepta.status).toBe(200);
      expect(acepta.body.ticket.estado).toBe('en_proceso');
      expect(acepta.body.estado.metricas.reservado.teraflops).toBe(12);
      expect(acepta.body.estado.metricas.libre.teraflops).toBe(6);

      const antesDeTiempo = await request(app)
        .post('/api/tickets/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_ticket: ticket.id_ticket });
      expect(antesDeTiempo.status).toBe(409);
      expect(antesDeTiempo.body.codigo).toBe('NOT_READY');

      const antes = await leerAlumno(ctx.A.id_alumno);
      await forzarEntrega(ticket.id_ticket);
      const res = await request(app)
        .post('/api/tickets/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_ticket: ticket.id_ticket });

      expect(res.status).toBe(200);
      expect(res.body.exito).toBe(true);
      expect(Number(res.body.creditosActuales)).toBeCloseTo(antes.creditos + Number(ticket.recompensa_creditos));

      const despues = await leerAlumno(ctx.A.id_alumno);
      expect(despues.creditos).toBeCloseTo(antes.creditos + Number(ticket.recompensa_creditos));
      expect(despues.reputacion).toBe(Math.min(100, antes.reputacion + ticket.recompensa_reputacion));
      expect(despues.contratos_finalizados).toBe(antes.contratos_finalizados + 1);
    });

    test('no se puede resolver dos veces el mismo ticket', async () => {
      const res = await request(app)
        .post('/api/tickets/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_ticket: tickets['Hospedaje Web PYME'].id_ticket });
      expect(res.status).toBe(400);
    });

    test('si se apaga el equipo durante el proceso, el ticket falla al entregarse', async () => {
      await request(app).post('/api/tickets/generar-demo').set(auth(ctx.A.tokenAlumno));
      const lista = await request(app).get('/api/tickets/pendientes').set(auth(ctx.A.tokenAlumno));
      const ticket = lista.body.filter((t) => t.descripcion === 'Hospedaje Web PYME').pop();

      const acepta = await request(app).post(`/api/tickets/${ticket.id_ticket}/aceptar`).set(auth(ctx.A.tokenAlumno));
      expect(acepta.status).toBe(200);
      const apaga = await request(app)
        .post(`/api/inventario/${ctx.A.id_servidor}/estado`)
        .set(auth(ctx.A.tokenAlumno))
        .send({ encendido: false });
      expect(apaga.status).toBe(200); // siempre se puede apagar (anti-softlock)

      const antes = await leerAlumno(ctx.A.id_alumno);
      await forzarEntrega(ticket.id_ticket);
      const tablero = await request(app).get('/api/tickets').set(auth(ctx.A.tokenAlumno));

      expect(tablero.status).toBe(200);
      const evento = tablero.body.eventos.find((e) => e.id_ticket === ticket.id_ticket);
      expect(evento.tipo).toBe('FALLIDO');
      const despues = await leerAlumno(ctx.A.id_alumno);
      expect(despues.creditos).toBeCloseTo(antes.creditos - Number(ticket.penalizacion_creditos));
      expect(despues.reputacion).toBe(Math.max(0, antes.reputacion - ticket.penalizacion_reputacion));

      await request(app).post(`/api/inventario/${ctx.A.id_servidor}/estado`).set(auth(ctx.A.tokenAlumno)).send({ encendido: true });
    });

    test('rechazar quita 5 de reputación y no se puede rechazar dos veces', async () => {
      const ticket = tickets['Procesamiento IA / ML'];
      const antes = await leerAlumno(ctx.A.id_alumno);

      const res = await request(app).post(`/api/tickets/${ticket.id_ticket}/rechazar`).set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(200);
      expect((await leerAlumno(ctx.A.id_alumno)).reputacion).toBe(Math.max(0, antes.reputacion - 5));

      const otraVez = await request(app).post(`/api/tickets/${ticket.id_ticket}/rechazar`).set(auth(ctx.A.tokenAlumno));
      expect(otraVez.status).toBe(409);
      expect(otraVez.body.codigo).toBe('ALREADY_PROCESSED');
    });

    test('un alumno no puede aceptar ni rechazar el ticket de otro', async () => {
      const id = tickets['Servidor Streaming Video'].id_ticket;
      const acepta = await request(app).post(`/api/tickets/${id}/aceptar`).set(auth(ctx.B.tokenAlumno));
      const rechaza = await request(app).post(`/api/tickets/${id}/rechazar`).set(auth(ctx.B.tokenAlumno));
      expect(acepta.status).toBe(404);
      expect(rechaza.status).toBe(404);
    });

    test('una solicitud sin respuesta a tiempo expira y quita reputación', async () => {
      const ticket = tickets['Servidor Streaming Video'];
      await db.query('UPDATE Tickets_Soporte SET fecha_limite = NOW() - INTERVAL 1 SECOND WHERE id_ticket = ?', [ticket.id_ticket]);
      const antes = await leerAlumno(ctx.A.id_alumno);

      const tablero = await request(app).get('/api/tickets').set(auth(ctx.A.tokenAlumno));
      expect(tablero.body.eventos.find((e) => e.id_ticket === ticket.id_ticket).tipo).toBe('EXPIRADO');
      expect(tablero.body.activos.find((t) => t.id_ticket === ticket.id_ticket)).toBeUndefined();
      expect((await leerAlumno(ctx.A.id_alumno)).reputacion).toBe(Math.max(0, antes.reputacion - 5));

      const acepta = await request(app).post(`/api/tickets/${ticket.id_ticket}/aceptar`).set(auth(ctx.A.tokenAlumno));
      expect(acepta.status).toBe(409);
      expect(acepta.body.codigo).toBe('EXPIRED');
    });
  });

  // ------------------------------------------------------------------
  // Incidentes aleatorios
  // ------------------------------------------------------------------
  describe('Incidentes del Data Center', () => {
    const accionCorrecta = async (id_incidente) => {
      const [rows] = await db.query(
        'SELECT accion_requerida, tipo, recompensa_creditos, recompensa_reputacion, penalizacion_reputacion FROM Incidentes_Activos WHERE id_incidente = ?',
        [id_incidente]
      );
      return rows[0];
    };

    let incidente;

    test('genera un incidente sin revelar la acción correcta', async () => {
      const res = await request(app).post('/api/eventos/generar').set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(201);
      expect(res.body.incidente.id_incidente).toBeDefined();
      expect(res.body.incidente.accion_requerida).toBeUndefined();
      incidente = res.body.incidente;
    });

    test('no permite tener dos incidentes activos a la vez', async () => {
      const res = await request(app).post('/api/eventos/generar').set(auth(ctx.A.tokenAlumno));
      expect(res.status).toBe(400);
    });

    test('lista el incidente activo solo para su dueño', async () => {
      const propio = await request(app).get('/api/eventos/activos').set(auth(ctx.A.tokenAlumno));
      expect(propio.body.map((i) => i.id_incidente)).toEqual([incidente.id_incidente]);

      const ajeno = await request(app).get('/api/eventos/activos').set(auth(ctx.B.tokenAlumno));
      expect(ajeno.body).toHaveLength(0);
    });

    test('un alumno no puede resolver el incidente de otro', async () => {
      const res = await request(app)
        .post('/api/eventos/resolver')
        .set(auth(ctx.B.tokenAlumno))
        .send({ id_incidente: incidente.id_incidente, accion_ejecutada: 'BLOQUEAR_IPS_FIREWALL' });
      expect(res.status).toBe(404);
    });

    test('una acción incorrecta penaliza al alumno', async () => {
      const datos = await accionCorrecta(incidente.id_incidente);
      const antes = await leerAlumno(ctx.A.id_alumno);

      const res = await request(app)
        .post('/api/eventos/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_incidente: incidente.id_incidente, accion_ejecutada: 'ACCION_INVENTADA' });

      expect(res.status).toBe(200);
      expect(res.body.exito).toBe(false);
      const despues = await leerAlumno(ctx.A.id_alumno);
      expect(despues.reputacion).toBe(Math.max(0, antes.reputacion - datos.penalizacion_reputacion));
    });

    test('la acción correcta mitiga el incidente y suma la recompensa', async () => {
      const nuevo = await request(app).post('/api/eventos/generar').set(auth(ctx.A.tokenAlumno));
      expect(nuevo.status).toBe(201);
      const id = nuevo.body.incidente.id_incidente;
      const datos = await accionCorrecta(id);
      const antes = await leerAlumno(ctx.A.id_alumno);

      const res = await request(app)
        .post('/api/eventos/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_incidente: id, accion_ejecutada: datos.accion_requerida });

      expect(res.status).toBe(200);
      expect(res.body.exito).toBe(true);
      const despues = await leerAlumno(ctx.A.id_alumno);
      expect(despues.creditos).toBeCloseTo(antes.creditos + Number(datos.recompensa_creditos));
      expect(despues.reputacion).toBe(antes.reputacion + datos.recompensa_reputacion);
      const ataques = datos.tipo === 'ATAQUE_SEGURIDAD' ? 1 : 0;
      expect(despues.ataquesResueltos).toBe(antes.ataquesResueltos + ataques);

      const repetido = await request(app)
        .post('/api/eventos/resolver')
        .set(auth(ctx.A.tokenAlumno))
        .send({ id_incidente: id, accion_ejecutada: datos.accion_requerida });
      expect(repetido.status).toBe(400);
    });
  });

  // ------------------------------------------------------------------
  // Compras simultáneas (bloqueo FOR UPDATE)
  // ------------------------------------------------------------------
  describe('Compras simultáneas', () => {
    test('dos compras al mismo tiempo no dejan el saldo en negativo', async () => {
      // Saldo para UNA sola compra del servidor Blade (250)
      await db.query('UPDATE Usuarios SET creditos = 300 WHERE id_usuario = ?', [ctx.B.id_alumno]);

      const comprar = () =>
        request(app).post('/api/tienda/comprar').set(auth(ctx.B.tokenAlumno)).send({ id_producto: 1 });
      const respuestas = await Promise.all([comprar(), comprar()]);
      const codigos = respuestas.map((r) => r.status).sort();

      expect(codigos).toEqual([200, 400]);
      const final = await leerAlumno(ctx.B.id_alumno);
      expect(final.creditos).toBeCloseTo(50);

      const inventario = await request(app).get('/api/tienda/inventario').set(auth(ctx.B.tokenAlumno));
      expect(inventario.body).toHaveLength(1);
    });
  });
});
