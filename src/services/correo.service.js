// Envío de correos (códigos de verificación de docentes).
//  - Con SMTP_HOST/SMTP_USER/SMTP_PASS en el .env: se envía de verdad (nodemailer).
//  - Sin SMTP y con EMAIL_MODO_CONSOLA=true: se escribe en la consola del servidor
//    (para desarrollo local y pruebas; se ve con `docker compose logs api`).
//  - Sin ninguno: lanza un error con codigo 'EMAIL_NO_CONFIGURADO'.
const nodemailer = require('nodemailer');

let transporte = null;
let enviadosConsola = []; // solo modo consola: lo leen las pruebas

const smtpConfigurado = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const modoConsola = () => process.env.EMAIL_MODO_CONSOLA === 'true';

const puedeEnviar = () => smtpConfigurado() || modoConsola();

const obtenerTransporte = () => {
  if (!transporte) {
    const puerto = Number(process.env.SMTP_PORT || 587);
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: puerto === 465, // 465 = TLS directo; 587 = STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporte;
};

const enviarCorreo = async ({ para, asunto, texto }) => {
  if (smtpConfigurado()) {
    await obtenerTransporte().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: para,
      subject: asunto,
      text: texto
    });
    return { via: 'smtp' };
  }
  if (modoConsola()) {
    enviadosConsola.push({ para, asunto, texto });
    console.log(`[correo:consola] Para: ${para} | ${asunto}\n${texto}`);
    return { via: 'consola' };
  }
  const error = new Error('El envío de correos no está configurado en el servidor');
  error.codigo = 'EMAIL_NO_CONFIGURADO';
  throw error;
};

module.exports = {
  puedeEnviar,
  enviarCorreo,
  ultimoEnviado: () => enviadosConsola[enviadosConsola.length - 1] || null,
  limpiarEnviados: () => { enviadosConsola = []; }
};
