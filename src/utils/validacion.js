// Validaciones del registro docente (funciones puras; se prueban en tests/unit).
const crypto = require('crypto');

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt solo usa los primeros 72 bytes

// Compara la clave maestra en tiempo constante: con `!==` la comparación se
// detiene en el primer carácter distinto y, midiendo tiempos de respuesta,
// se podría ir adivinando la clave. Se comparan los SHA-256 para que ambos
// lados tengan siempre la misma longitud (timingSafeEqual lo exige).
const claveMaestraValida = (enviada, esperada) => {
  if (typeof enviada !== 'string' || typeof esperada !== 'string' || esperada.length === 0) return false;
  const a = crypto.createHash('sha256').update(enviada, 'utf8').digest();
  const b = crypto.createHash('sha256').update(esperada, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
};

const normalizarCorreo = (correo) => String(correo || '').trim().toLowerCase();

// Formato básico usuario@dominio.ext (no verifica que el correo exista).
const correoValido = (correo) =>
  typeof correo === 'string' && correo.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);

// Devuelve null si la contraseña es aceptable, o el motivo para mostrar al docente.
const problemaPassword = (password) => {
  if (typeof password !== 'string') return 'La contraseña es obligatoria';
  if (password.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres`;
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX) return `La contraseña no puede tener más de ${PASSWORD_MAX} caracteres`;
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(password) || !/\d/.test(password)) {
    return 'La contraseña debe combinar letras y números';
  }
  return null;
};

// true si el correo pertenece a uno de los dominios (o a un subdominio de ellos).
// Lista vacía = cualquier dominio.
const correoEnDominios = (correo, dominios) => {
  if (!dominios || dominios.length === 0) return true;
  const dominio = String(correo || '').split('@').pop().toLowerCase();
  return dominios.some((d) => dominio === d || dominio.endsWith(`.${d}`));
};

// Código numérico de N dígitos con generador criptográfico (incluye ceros a la izquierda).
const generarCodigo = (digitos = 6) =>
  String(crypto.randomInt(0, 10 ** digitos)).padStart(digitos, '0');

module.exports = {
  PASSWORD_MIN,
  claveMaestraValida,
  normalizarCorreo,
  correoValido,
  problemaPassword,
  correoEnDominios,
  generarCodigo
};
