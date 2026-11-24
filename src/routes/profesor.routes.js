const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const {
  claveMaestraValida, normalizarCorreo, correoValido, problemaPassword, correoEnDominios, generarCodigo
} = require('../utils/validacion');
const { VERIFICACION, verificacionActiva, dominiosPermitidos } = require('../config/docentes');
const correoSvc = require('../services/correo.service');

// ======================================================================
// MIDDLEWARE DE AUTORIZACIÓN: Solo Docentes / Administradores
// ======================================================================
const verificarTokenDocente = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado: Token de autenticación requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    if (decoded.rol !== 'admin') {
      return res.status(403).json({ error: 'Acceso restringido: Se requieren privilegios de docente' });
    }
    req.profesor = decoded;
    next();
  });
};

// ======================================================================
// 1. REGISTRO DE NUEVO PROFESOR (Protegido por Clave Maestra)
// ======================================================================
router.post('/registro', async (req, res) => {
  let conn = null; // se pide la conexión solo cuando ya pasaron las validaciones
  try {
    const { nombre, correo, password, clave_maestra } = req.body || {};

    if (!nombre || !correo || !password || !clave_maestra) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    // Validación de la clave maestra institucional definida en el .env.
    // Va primero: sin la clave correcta no se revela nada más del registro.
    if (!claveMaestraValida(clave_maestra, process.env.ADMIN_REGISTRATION_KEY)) {
      return res.status(403).json({
        error: 'Acceso no autorizado: La clave maestra institucional es incorrecta'
      });
    }

    const correoLimpio = normalizarCorreo(correo);
    if (!correoValido(correoLimpio)) {
      return res.status(400).json({ error: 'El correo no tiene un formato válido' });
    }
    const dominios = dominiosPermitidos();
    if (!correoEnDominios(correoLimpio, dominios)) {
      return res.status(400).json({
        error: `Usa tu correo institucional (${dominios.map((d) => `@${d}`).join(', ')})`,
        codigo: 'DOMINIO_NO_PERMITIDO'
      });
    }
    const motivo = problemaPassword(password);
    if (motivo) {
      return res.status(400).json({ error: motivo });
    }
    if (typeof nombre !== 'string' || nombre.trim().length < 3 || nombre.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre debe tener entre 3 y 100 caracteres' });
    }

    const verificar = verificacionActiva();
    if (verificar && !correoSvc.puedeEnviar()) {
      return res.status(503).json({
        error: 'El servidor todavía no puede enviar correos de verificación. Avisa al administrador.',
        codigo: 'EMAIL_NO_CONFIGURADO'
      });
    }

    conn = await db.getConnection();
    await conn.beginTransaction();
    const [existente] = await conn.query(
      'SELECT id_profesor, verificado FROM Profesores WHERE correo = ? FOR UPDATE',
      [correoLimpio]
    );
    if (existente.length > 0) {
      await conn.rollback();
      if (!existente[0].verificado) {
        return res.status(400).json({
          error: 'Ya hay un registro pendiente con este correo: escribe el código que te enviamos o pide uno nuevo.',
          codigo: 'VERIFICACION_PENDIENTE'
        });
      }
      return res.status(400).json({ error: 'Ya existe una cuenta docente con este correo' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const codigo = verificar ? generarCodigo(VERIFICACION.DIGITOS) : null;
    const [resultado] = await conn.query(
      `INSERT INTO Profesores
         (nombre, correo, password_hash, verificado, codigo_hash, codigo_expira, codigo_enviado)
       VALUES (?, ?, ?, ?, ?, ${verificar ? 'NOW() + INTERVAL ? MINUTE' : 'NULL'}, ${verificar ? 'NOW()' : 'NULL'})`,
      verificar
        ? [nombre.trim(), correoLimpio, password_hash, false, await bcrypt.hash(codigo, 10), VERIFICACION.MINUTOS_VIGENCIA]
        : [nombre.trim(), correoLimpio, password_hash, true, null]
    );

    if (verificar) {
      // Si el correo no sale, no se crea la cuenta (rollback).
      await correoSvc.enviarCorreo({
        para: correoLimpio,
        asunto: 'Cyber Tycoon: tu código de verificación',
        texto: textoCodigo(nombre.trim(), codigo)
      });
    }
    await conn.commit();

    res.status(201).json({
      mensaje: verificar
        ? `Te enviamos un código de ${VERIFICACION.DIGITOS} dígitos a ${correoLimpio}. Escríbelo para activar tu cuenta.`
        : 'Docente registrado exitosamente',
      id_profesor: resultado.insertId,
      requiere_verificacion: verificar,
      correo: correoLimpio
    });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('Error en /registro docente:', error);
    if (error.codigo === 'EMAIL_NO_CONFIGURADO') {
      return res.status(503).json({ error: error.message, codigo: error.codigo });
    }
    res.status(500).json({ error: 'No se pudo completar el registro (¿falló el envío del correo?). Intenta de nuevo.' });
  } finally {
    if (conn) conn.release();
  }
});

const textoCodigo = (nombre, codigo) =>
  `Hola ${nombre}:\n\n` +
  `Tu código para activar tu cuenta docente de Cyber Tycoon es: ${codigo}\n\n` +
  `Vence en ${VERIFICACION.MINUTOS_VIGENCIA} minutos. Si no fuiste tú, ignora este correo.`;

// ======================================================================
// 1b. VERIFICAR EL CORREO CON EL CÓDIGO  { correo, codigo }
// ======================================================================
router.post('/verificar', async (req, res) => {
  const { correo, codigo } = req.body || {};
  const correoLimpio = normalizarCorreo(correo);
  const codigoLimpio = String(codigo || '').trim();
  if (!correoValido(correoLimpio) || !new RegExp(`^\\d{${VERIFICACION.DIGITOS}}$`).test(codigoLimpio)) {
    return res.status(400).json({ error: `Escribe tu correo y el código de ${VERIFICACION.DIGITOS} dígitos` });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [filas] = await conn.query(
      `SELECT id_profesor, verificado, codigo_hash, codigo_intentos,
              codigo_expira IS NULL OR codigo_expira < NOW() AS expirado
       FROM Profesores WHERE correo = ? FOR UPDATE`,
      [correoLimpio]
    );
    const p = filas[0];
    // Mismo mensaje si el correo no existe: no se revela quién está registrado.
    if (!p) {
      await conn.rollback();
      return res.status(400).json({ error: 'Código incorrecto o expirado', codigo: 'CODIGO_INVALIDO' });
    }
    if (p.verificado) {
      await conn.rollback();
      return res.json({ mensaje: 'Tu cuenta ya estaba verificada. Inicia sesión.' });
    }
    if (Number(p.codigo_intentos) >= VERIFICACION.MAX_INTENTOS) {
      await conn.rollback();
      return res.status(429).json({ error: 'Demasiados intentos. Pide un código nuevo.', codigo: 'DEMASIADOS_INTENTOS' });
    }
    if (Number(p.expirado) === 1) {
      await conn.rollback();
      return res.status(410).json({ error: 'El código expiró. Pide uno nuevo.', codigo: 'CODIGO_EXPIRADO' });
    }

    const correcto = await bcrypt.compare(codigoLimpio, p.codigo_hash);
    if (!correcto) {
      await conn.query('UPDATE Profesores SET codigo_intentos = codigo_intentos + 1 WHERE id_profesor = ?', [p.id_profesor]);
      await conn.commit();
      const restantes = VERIFICACION.MAX_INTENTOS - Number(p.codigo_intentos) - 1;
      return res.status(400).json({
        error: restantes > 0 ? `Código incorrecto. Te quedan ${restantes} intento(s).` : 'Código incorrecto. Pide un código nuevo.',
        codigo: 'CODIGO_INVALIDO',
        intentos_restantes: restantes
      });
    }

    await conn.query(
      `UPDATE Profesores SET verificado = TRUE, codigo_hash = NULL, codigo_expira = NULL, codigo_intentos = 0
       WHERE id_profesor = ?`,
      [p.id_profesor]
    );
    await conn.commit();
    res.json({ mensaje: '¡Correo verificado! Ya puedes iniciar sesión.' });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('Error en /verificar docente:', error);
    res.status(500).json({ error: 'Error al verificar el código' });
  } finally {
    conn.release();
  }
});

// ======================================================================
// 1c. REENVIAR EL CÓDIGO  { correo }
// ======================================================================
router.post('/reenviar-codigo', async (req, res) => {
  const correoLimpio = normalizarCorreo((req.body || {}).correo);
  if (!correoValido(correoLimpio)) {
    return res.status(400).json({ error: 'Escribe un correo válido' });
  }
  const generico = { mensaje: 'Si hay un registro pendiente con ese correo, te enviamos un código nuevo.' };
  if (!verificacionActiva() || !correoSvc.puedeEnviar()) {
    return res.status(503).json({ error: 'El servidor no puede enviar correos ahora mismo.', codigo: 'EMAIL_NO_CONFIGURADO' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [filas] = await conn.query(
      `SELECT id_profesor, nombre, verificado, TIMESTAMPDIFF(SECOND, codigo_enviado, NOW()) AS desde_envio
       FROM Profesores WHERE correo = ? FOR UPDATE`,
      [correoLimpio]
    );
    const p = filas[0];
    if (!p || p.verificado) {
      await conn.rollback();
      return res.json(generico);
    }
    if (p.desde_envio !== null && Number(p.desde_envio) < VERIFICACION.SEGUNDOS_ENTRE_ENVIOS) {
      await conn.rollback();
      const espera = VERIFICACION.SEGUNDOS_ENTRE_ENVIOS - Number(p.desde_envio);
      return res.status(429).json({ error: `Espera ${espera} s para pedir otro código.`, codigo: 'ESPERA_REENVIO', segundos: espera });
    }

    const codigo = generarCodigo(VERIFICACION.DIGITOS);
    await conn.query(
      `UPDATE Profesores SET codigo_hash = ?, codigo_expira = NOW() + INTERVAL ? MINUTE,
         codigo_intentos = 0, codigo_enviado = NOW()
       WHERE id_profesor = ?`,
      [await bcrypt.hash(codigo, 10), VERIFICACION.MINUTOS_VIGENCIA, p.id_profesor]
    );
    await correoSvc.enviarCorreo({
      para: correoLimpio,
      asunto: 'Cyber Tycoon: tu nuevo código de verificación',
      texto: textoCodigo(p.nombre, codigo)
    });
    await conn.commit();
    res.json(generico);
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('Error en /reenviar-codigo docente:', error);
    res.status(500).json({ error: 'No se pudo enviar el código. Intenta de nuevo.' });
  } finally {
    conn.release();
  }
});

// ======================================================================
// 2. LOGIN DE PROFESOR
// ======================================================================
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({ error: 'Correo y contraseña requeridos' });
    }

    const [profesores] = await db.query(
      'SELECT * FROM Profesores WHERE correo = ?',
      [normalizarCorreo(correo)]
    );

    if (profesores.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const profesor = profesores[0];
    const passwordValido = await bcrypt.compare(password, profesor.password_hash);

    if (!passwordValido) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Solo después de una contraseña correcta: no revela qué correos existen.
    if (!profesor.verificado) {
      return res.status(403).json({
        error: 'Tu correo aún no está verificado. Escribe el código que te enviamos o pide uno nuevo.',
        codigo: 'CORREO_NO_VERIFICADO',
        correo: profesor.correo
      });
    }

    // Generar JWT administrativo
    const token = jwt.sign(
      {
        id_profesor: profesor.id_profesor,
        nombre: profesor.nombre,
        correo: profesor.correo,
        rol: 'admin'
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      mensaje: 'Autenticación exitosa',
      token,
      profesor: {
        id_profesor: profesor.id_profesor,
        nombre: profesor.nombre,
        correo: profesor.correo
      }
    });
  } catch (error) {
    console.error('Error en /login docente:', error);
    res.status(500).json({ error: 'Error interno en el servidor al iniciar sesión' });
  }
});

// ======================================================================
// 3. OBTENER CLASES DEL PROFESOR
// ======================================================================
router.get('/clases', verificarTokenDocente, async (req, res) => {
  try {
    const id_profesor = req.profesor.id_profesor;

    const [clases] = await db.query(
      'SELECT id_clase, nombre_clase, codigo_clase, activa, fecha_creacion FROM Clases WHERE id_profesor = ? ORDER BY fecha_creacion DESC',
      [id_profesor]
    );

    res.json(clases);
  } catch (error) {
    console.error('Error en GET /clases:', error);
    res.status(500).json({ error: 'Error al obtener las clases' });
  }
});

// ======================================================================
// 4. CREAR NUEVA CLASE (Genera código CT-XXXXX)
// ======================================================================
router.post('/clases', verificarTokenDocente, async (req, res) => {
  try {
    const { nombre_clase } = req.body;
    const id_profesor = req.profesor.id_profesor;

    if (!nombre_clase || nombre_clase.trim() === '') {
      return res.status(400).json({ error: 'El nombre de la clase es requerido' });
    }

    // Generar sufijo alfanumérico aleatorio de 5 caracteres
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let codigoAleatorio = '';
    for (let i = 0; i < 5; i++) {
      codigoAleatorio += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    const codigo_clase = `CT-${codigoAleatorio}`;

    const [resultado] = await db.query(
      'INSERT INTO Clases (id_profesor, nombre_clase, codigo_clase, activa) VALUES (?, ?, ?, 1)',
      [id_profesor, nombre_clase.trim(), codigo_clase]
    );

    res.status(201).json({
      mensaje: 'Clase creada exitosamente',
      id_clase: resultado.insertId,
      nombre_clase: nombre_clase.trim(),
      codigo_clase
    });
  } catch (error) {
    console.error('Error en POST /clases:', error);
    res.status(500).json({ error: 'Error al generar la clase' });
  }
});

// ======================================================================
// 5. ELIMINAR CLASE COMPLETA (Y alumnos asociados en cascada)
// ======================================================================
router.delete('/clases/:id_clase', verificarTokenDocente, async (req, res) => {
  try {
    const { id_clase } = req.params;
    const id_profesor = req.profesor.id_profesor;

    // Validar que la clase pertenezca al profesor autenticado
    const [clases] = await db.query(
      'SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?',
      [id_clase, id_profesor]
    );

    if (clases.length === 0) {
      return res.status(403).json({ error: 'No tienes autorización para eliminar esta clase o no existe' });
    }

    await db.query('DELETE FROM Clases WHERE id_clase = ?', [id_clase]);

    res.json({ mensaje: 'Clase y estudiantes asociados eliminados con éxito' });
  } catch (error) {
    console.error('Error en DELETE /clases/:id_clase:', error);
    res.status(500).json({ error: 'Error en el servidor al eliminar la clase' });
  }
});

// ======================================================================
// 6. CREAR UN ESTUDIANTE MANUALMENTE DENTRO DE UNA CLASE
// ======================================================================
router.post('/clases/:id_clase/estudiantes', verificarTokenDocente, async (req, res) => {
  try {
    const { id_clase } = req.params;
    const { nombreUsuario } = req.body;
    const id_profesor = req.profesor.id_profesor;

    if (!nombreUsuario || nombreUsuario.trim() === '') {
      return res.status(400).json({ error: 'El nombre o alias del estudiante es obligatorio' });
    }

    // Validar pertenencia de la clase
    const [clases] = await db.query(
      'SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?',
      [id_clase, id_profesor]
    );

    if (clases.length === 0) {
      return res.status(403).json({ error: 'No tienes permisos sobre esta clase' });
    }

    // Verificar que el alias no esté duplicado en esta clase
    const [existente] = await db.query(
      'SELECT id_usuario FROM Usuarios WHERE nombreUsuario = ? AND id_clase = ?',
      [nombreUsuario.trim(), id_clase]
    );

    if (existente.length > 0) {
      return res.status(400).json({ error: 'Ya existe un estudiante con este alias en la clase' });
    }

    // Crear alumno con métricas de inicio de fábrica
    const [resultado] = await db.query(
      `INSERT INTO Usuarios
        (id_clase, nombreUsuario, creditos, reputacion, teraflopsCD, temperaturaCD, memoriaDisponibleCD, ancho_bandaCD, carga_electrica_actual, capacidad_watts, espacioFisicoDisponible)
       VALUES (?, ?, 1000.00, 50, 10, 35, 16, 100, 250, 1000, 42)`,
      [id_clase, nombreUsuario.trim()]
    );

    res.status(201).json({
      mensaje: 'Estudiante dado de alta exitosamente',
      id_usuario: resultado.insertId,
      nombreUsuario: nombreUsuario.trim()
    });
  } catch (error) {
    console.error('Error en POST /clases/:id_clase/estudiantes:', error);
    res.status(500).json({ error: 'Error en el servidor al crear el estudiante' });
  }
});

// ======================================================================
// 7. CONSULTAR MÉTRICAS EN VIVO DE LOS ALUMNOS DE UNA CLASE
// ======================================================================
router.get('/clases/:id_clase/alumnos', verificarTokenDocente, async (req, res) => {
  try {
    const { id_clase } = req.params;
    const id_profesor = req.profesor.id_profesor;

    // Verificar pertenencia de la clase
    const [clases] = await db.query(
      'SELECT id_clase FROM Clases WHERE id_clase = ? AND id_profesor = ?',
      [id_clase, id_profesor]
    );

    if (clases.length === 0) {
      return res.status(403).json({ error: 'Acceso no autorizado a esta clase' });
    }

    const [alumnos] = await db.query(
      `SELECT
        id_usuario,
        nombreUsuario,
        creditos,
        reputacion,
        estado_partida,
        teraflopsCD,
        temperaturaCD,
        memoriaDisponibleCD,
        ancho_bandaCD,
        carga_electrica_actual,
        capacidad_watts,
        espacioFisicoDisponible,
        contratos_finalizados,
        ataquesResueltos
       FROM Usuarios
       WHERE id_clase = ?
       ORDER BY reputacion DESC, creditos DESC`,
      [id_clase]
    );

    res.json(alumnos);
  } catch (error) {
    console.error('Error en GET /clases/:id_clase/alumnos:', error);
    res.status(500).json({ error: 'Error al consultar las métricas de los estudiantes' });
  }
});

// ======================================================================
// 8. ELIMINAR A UN ESTUDIANTE ESPECÍFICO
// ======================================================================
router.delete('/estudiantes/:id_usuario', verificarTokenDocente, async (req, res) => {
  try {
    const { id_usuario } = req.params;
    const id_profesor = req.profesor.id_profesor;

    // Verificar que el alumno pertenezca a una clase del profesor logueado
    const [usuario] = await db.query(
      `SELECT u.id_usuario
       FROM Usuarios u
       INNER JOIN Clases c ON u.id_clase = c.id_clase
       WHERE u.id_usuario = ? AND c.id_profesor = ?`,
      [id_usuario, id_profesor]
    );

    if (usuario.length === 0) {
      return res.status(403).json({ error: 'No tienes autorización para eliminar este estudiante' });
    }

    await db.query('DELETE FROM Usuarios WHERE id_usuario = ?', [id_usuario]);

    res.json({ mensaje: 'Estudiante eliminado con éxito' });
  } catch (error) {
    console.error('Error en DELETE /estudiantes/:id_usuario:', error);
    res.status(500).json({ error: 'Error en el servidor al eliminar estudiante' });
  }
});

// ======================================================================
// 9. DAR DE BAJA LA CUENTA DEL DOCENTE  { password }
// Borra al docente y, en cascada (llaves foráneas ON DELETE CASCADE), sus
// clases, sus alumnos y todo lo de sus partidas (equipos, tickets, incidentes
// e historial). Pide la contraseña otra vez: un panel olvidado abierto no basta.
// ======================================================================
router.delete('/cuenta', verificarTokenDocente, async (req, res) => {
  const id_profesor = req.profesor.id_profesor;
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Escribe tu contraseña para confirmar la baja' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [filas] = await conn.query(
      'SELECT id_profesor, correo, password_hash FROM Profesores WHERE id_profesor = ? FOR UPDATE',
      [id_profesor]
    );
    if (filas.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'La cuenta ya no existe', codigo: 'NOT_FOUND' });
    }
    if (!(await bcrypt.compare(password, filas[0].password_hash))) {
      await conn.rollback();
      // 400 y no 401: la sesión es válida; solo falló la confirmación (el panel
      // cierra la sesión ante cualquier 401).
      return res.status(400).json({ error: 'Contraseña incorrecta', codigo: 'PASSWORD_INCORRECTA' });
    }

    const [[conteo]] = await conn.query(
      `SELECT COUNT(DISTINCT c.id_clase) AS clases, COUNT(u.id_usuario) AS alumnos
       FROM Clases c LEFT JOIN Usuarios u ON u.id_clase = c.id_clase
       WHERE c.id_profesor = ?`,
      [id_profesor]
    );
    await conn.query('DELETE FROM Profesores WHERE id_profesor = ?', [id_profesor]);
    await conn.commit();

    console.log(`[docentes] Baja de la cuenta ${filas[0].correo} (${conteo.clases} clases, ${conteo.alumnos} alumnos)`);
    res.json({
      mensaje: 'Tu cuenta fue dada de baja junto con tus clases y alumnos.',
      clases_eliminadas: Number(conteo.clases),
      alumnos_eliminados: Number(conteo.alumnos)
    });
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error('Error en DELETE /cuenta:', error);
    res.status(500).json({ error: 'Error en el servidor al dar de baja la cuenta' });
  } finally {
    conn.release();
  }
});

module.exports = router;
