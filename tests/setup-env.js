// Variables de entorno por defecto para las pruebas.
// En GitHub Actions se sobrescriben desde el workflow.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'jwt_secret_de_pruebas';
process.env.ADMIN_REGISTRATION_KEY = process.env.ADMIN_REGISTRATION_KEY || 'clave_maestra_pruebas';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_USER = process.env.DB_USER || 'root';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'root';
process.env.DB_NAME = process.env.DB_NAME || 'cyber_tycoon';
