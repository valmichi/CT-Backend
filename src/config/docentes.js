// Registro de docentes: verificación del correo institucional.
//
// Variables del .env (todas opcionales; ver .env.example):
//   DOCENTES_DOMINIOS          dominios permitidos separados por coma (ej. "uaa.mx,edu.uaa.mx").
//                              Vacío = cualquier dominio (solo se exige el código).
//   DOCENTES_VERIFICAR_CORREO  "false" para desactivar el código (las cuentas nacen verificadas).
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM   cuenta que envía los códigos.
//   EMAIL_MODO_CONSOLA         "true" en desarrollo: el código se escribe en la consola del
//                              servidor (docker compose logs api) en lugar de enviarse.
const VERIFICACION = Object.freeze({
  DIGITOS: 6,
  MINUTOS_VIGENCIA: 15,     // el código caduca a los 15 minutos
  MAX_INTENTOS: 5,          // después hay que pedir uno nuevo
  SEGUNDOS_ENTRE_ENVIOS: 60 // para "reenviar código"
});

const verificacionActiva = () => process.env.DOCENTES_VERIFICAR_CORREO !== 'false';

const dominiosPermitidos = () =>
  String(process.env.DOCENTES_DOMINIOS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

module.exports = { VERIFICACION, verificacionActiva, dominiosPermitidos };
