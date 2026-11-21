const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const db = require('./config/db');

// Rutas
const authRoutes = require('./routes/auth.routes');
const profesorRoutes = require('./routes/profesor.routes');
const clasesRoutes = require('./routes/clases.routes');
const tiendaRoutes = require('./routes/tienda.routes');
const jugadorRoutes = require('./routes/jugador.routes');
const ticketsRoutes = require('./routes/tickets.routes');
const adminRoutes = require('./routes/admin.routes');
const eventosRoutes = require('./routes/eventos.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const inventarioRoutes = require('./routes/inventario.routes');

const app = express();

// Detrás de un proxy/túnel (Cloudflare Tunnel, Tailscale Funnel, Nginx) la IP real
// del cliente llega en X-Forwarded-For. Sin esto, el rate limiter vería a todos los
// jugadores como una sola IP. TRUST_PROXY = número de proxies delante (p. ej. 1).
if (process.env.TRUST_PROXY) {
  const valor = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(valor) ? process.env.TRUST_PROXY : valor);
}

// ----------------------------------------------------------------------
// 1. SEGURIDAD DE CABECERAS HTTP (Helmet)
// ----------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Permite los scripts en línea del dashboard
        styleSrc: ["'self'", "'unsafe-inline'"],  // Permite los estilos en línea
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// ----------------------------------------------------------------------
// 2. CONFIGURACIÓN DE CORS Y PARSERS
// ----------------------------------------------------------------------
app.use(cors());
// Límite estricto de 10kb para mitigar ataques DoS por cuerpos gigantes
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ----------------------------------------------------------------------
// 3. RATE LIMITING (Mitigación de Fuerza Bruta y Saturación DoS)
// ----------------------------------------------------------------------
// Limitador general para el consumo de la API (300 req / 15 min por IP)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de solicitudes alcanzado. Intenta de nuevo más tarde.' }
});
app.use('/api', apiLimiter);

// Limitador estricto para autenticación (Máximo 15 intentos cada 15 min)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Acceso suspendido temporalmente por 15 minutos.' }
});

// ----------------------------------------------------------------------
// 4. DASHBOARD DOCENTE (Archivos Estáticos)
// ----------------------------------------------------------------------
app.use('/admin-dashboard', express.static(path.join(__dirname, '../public')));

// ----------------------------------------------------------------------
// 5. MAPEO DE ENDPOINTS REST
// ----------------------------------------------------------------------
// Rutas sensibles con limitador estricto
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/profesor/login', authLimiter);
app.use('/api/profesor/registro', authLimiter);

// Rutas generales
app.use('/api/profesor', profesorRoutes);
app.use('/api/profesor/clases', clasesRoutes);
app.use('/api/tienda', tiendaRoutes);
app.use('/api/jugador', jugadorRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/eventos', eventosRoutes);
app.use('/api/usuario', usuarioRoutes);
app.use('/api/inventario', inventarioRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT NOW() as horaServidor');
    res.json({ status: 'OK', hora: rows[0].horaServidor });
  } catch (error) {
    res.status(500).json({ error: 'Fallo conexión con MySQL', detalle: error.message });
  }
});

// Manejador centralizado de errores (oculta stacktraces sensibles al cliente)
// Los errores del cliente que marca body-parser (JSON mal formado = 400,
// cuerpo mayor a 10kb = 413) se devuelven con su código; el resto es 500.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode;
  if (status >= 400 && status < 500) {
    const mensajes = {
      400: 'La petición tiene un formato inválido.',
      413: 'El cuerpo de la petición excede el tamaño permitido.'
    };
    return res.status(status).json({ error: mensajes[status] || 'Petición inválida.' });
  }
  console.error('Error interno detectado:', err.stack);
  res.status(500).json({ error: 'Ocurrió un error interno en el servidor.' });
});

// Solo levanta el servidor si se ejecuta directamente (node src/app.js).
// Al importarse desde las pruebas (Jest + Supertest) no abre el puerto.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Backend blindado de Cyber Tycoon activo en http://localhost:${PORT}`);
    console.log(`Dashboard Docente: http://localhost:${PORT}/admin-dashboard`);
  });
}

module.exports = app;
