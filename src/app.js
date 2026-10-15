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

const app = express();

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
app.use((err, req, res, next) => {
  console.error('Error interno detectado:', err.stack);
  res.status(500).json({ error: 'Ocurrió un error interno en el servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend blindado de Cyber Tycoon activo en http://localhost:${PORT}`);
  console.log(`Dashboard Docente: http://localhost:${PORT}/admin-dashboard`);
});
