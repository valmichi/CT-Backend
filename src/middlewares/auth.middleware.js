const jwt = require('jsonwebtoken');

// Valida que la petición incluya un token JWT válido
const autenticarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Formato: Bearer <TOKEN>

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado: Token no proporcionado' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.usuario = payload;
    next();
  });
};

// Exige que el token pertenezca estrictamente a un profesor
const requerirProfesor = (req, res, next) => {
  if (!req.usuario || req.usuario.rol !== 'profesor') {
    return res.status(403).json({ error: 'Acceso restringido: Se requieren privilegios de docente' });
  }
  next();
};

module.exports = {
  autenticarToken,
  requerirProfesor
};
