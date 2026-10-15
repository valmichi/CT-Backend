# Cyber Tycoon API & Teacher Dashboard

Servidor autoritativo y panel de supervisión docente para el simulador de gestión de centros de datos y ciberseguridad Cyber Tycoon.

Este backend desacopla la lógica de cómputo del cliente ligero (Godot Engine) para validar transacciones, métricas de hardware, incidentes de red y control de aulas en tiempo real.

---

## Arquitectura del Sistema

El sistema implementa una arquitectura cliente ligero / backend autoritativo:
* Godot Engine (Cliente): Responsable exclusivo de la interfaz gráfica, animaciones y recolección de interacciones del usuario.
* Node.js + Express (API REST): Centraliza la lógica de negocio (cálculo de TFLOPS, consumo de watts, curvas de temperatura, saldo e inventario).
* MySQL: Persistencia transaccional con integridad referencial y borrado en cascada (ON DELETE CASCADE).
* Dashboard Web Docente: Interfaz modular (HTML5, CSS3, JS Vanilla) que provee telemetría grupal en vivo, auditoría y control de alumnos.

---

## Seguridad en Profundidad

* Autenticación Stateless (JWT): Generación de tokens firmados mediante algoritmo HMAC-SHA256 (HS256) para la gestión de sesiones de alumnos y profesores.
* Criptografía de Contraseñas (Bcrypt): Hashing salado con un factor de trabajo de 10 rondas para credenciales docentes.
* Control de Acceso Basado en Roles (RBAC): Segregación estricta entre estudiantes y administradores.
* Clave Maestra Institucional: Registro de cuentas docentes condicionado a una variable secreta del entorno (ADMIN_REGISTRATION_KEY).
* Protección contra Fuerza Bruta y DoS: Implementación de express-rate-limit con políticas diferenciadas (límite general y restricción estricta en endpoints de acceso).
* Cabeceras Defensivas (Helmet): Políticas estrictas de Content Security Policy (CSP), deshabilitación de X-Powered-By y prevención de clickjacking.
* Sanitización Contextual Anti-XSS: Desinfección de variables previas a su inyección en el DOM del panel de supervisión.

---

## Requisitos Previos

* Node.js (versión 18 o superior)
* MySQL Server (versión 8.0 o superior)
* Gestor de paquetes npm

  ### 1. Clonar el repositorio
git clone [https://github.com/tu-usuario/cyber-tycoon-api.git](https://github.com/tu-usuario/cyber-tycoon-api.git)
cd cyber-tycoon-api

  ### 2. Instalar dependencias
npm install
