-- ==========================================================
-- CYBER TYCOON: SISTEMA DE GESTIÓN DE RECURSOS (DATA CENTER)
-- Script Completo de Inicialización de Base de Datos MySQL
-- ==========================================================

-- El cliente mysql del contenedor usa latin1 por defecto: sin esto los acentos
-- del catálogo ("NocturnaBúho", "Tésla"...) se guardan corruptos ("NocturnaBÃºho").
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS cyber_tycoon
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE cyber_tycoon;

-- Desactivar temporalmente revisión de llaves foráneas para recrear sin conflictos
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS Historial_Actividad;
DROP TABLE IF EXISTS Incidentes_Activos;
DROP TABLE IF EXISTS Tickets_Soporte;
DROP TABLE IF EXISTS Inventario_Usuario;
DROP TABLE IF EXISTS Catalogo_Productos;
DROP TABLE IF EXISTS Usuarios;
DROP TABLE IF EXISTS Clases;
DROP TABLE IF EXISTS Profesores;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------
-- 1. TABLA: Profesores
-- ----------------------------------------------------------
CREATE TABLE Profesores (
    id_profesor INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 2. TABLA: Clases
-- ----------------------------------------------------------
CREATE TABLE Clases (
    id_clase INT AUTO_INCREMENT PRIMARY KEY,
    id_profesor INT NOT NULL,
    nombre_clase VARCHAR(100) NOT NULL,
    codigo_clase VARCHAR(10) NOT NULL UNIQUE,
    activa BOOLEAN DEFAULT TRUE,
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_clases_profesores
        FOREIGN KEY (id_profesor) REFERENCES Profesores(id_profesor)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 3. TABLA: Usuarios (Estudiantes / Data Centers)
-- ----------------------------------------------------------
CREATE TABLE Usuarios (
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    id_clase INT NOT NULL,
    nombreUsuario VARCHAR(50) NOT NULL,
    rol ENUM('estudiante', 'admin') DEFAULT 'estudiante',
    creditos DECIMAL(10, 2) DEFAULT 1000.00,
    reputacion INT DEFAULT 50,
    teraflopsCD INT DEFAULT 10,
    temperaturaCD INT DEFAULT 35,
    memoriaDisponibleCD INT DEFAULT 16,
    ancho_bandaCD INT DEFAULT 100,
    carga_electrica_actual INT DEFAULT 250,
    capacidad_watts INT DEFAULT 1000,
    espacioFisicoDisponible INT DEFAULT 42,
    contratos_finalizados INT DEFAULT 0,
    ataquesResueltos INT DEFAULT 0,
    fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuarios_clases
        FOREIGN KEY (id_clase) REFERENCES Clases(id_clase)
        ON DELETE CASCADE,
    CONSTRAINT uq_usuario_clase UNIQUE (nombreUsuario, id_clase)
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 4. TABLA: Catalogo_Productos (Hardware & Infraestructura)
-- ----------------------------------------------------------
CREATE TABLE Catalogo_Productos (
    id_producto INT AUTO_INCREMENT PRIMARY KEY,
    nombreProducto VARCHAR(100) NOT NULL,
    categoria ENUM('Servidor', 'Refrigeracion', 'Energia', 'Redes') NOT NULL,
    costo DECIMAL(10, 2) NOT NULL,
    espacioNecesario INT NOT NULL,
    aumento_teraflops INT DEFAULT 0,
    impacto_temperatura INT DEFAULT 0,
    aumento_memoria INT DEFAULT 0,
    impacto_anchoDeBanda INT DEFAULT 0,
    consumoElectrico INT DEFAULT 0,
    aumento_watts INT DEFAULT 0
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 5. TABLA: Inventario_Usuario
-- ----------------------------------------------------------
CREATE TABLE Inventario_Usuario (
    id_inventario INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    id_producto INT NOT NULL,
    encendido BOOLEAN NOT NULL DEFAULT TRUE,   -- apagado: ocupa espacio, 0 W y 0 calor
    rack_numero TINYINT NULL,                  -- 1..NUM_RACKS (src/config/juego.js)
    slot_inicio TINYINT NULL,                  -- 0..U_POR_RACK-1, primera U que ocupa
    fecha_compra DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inventario_usuario
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario)
        ON DELETE CASCADE,
    CONSTRAINT fk_inventario_producto
        FOREIGN KEY (id_producto) REFERENCES Catalogo_Productos(id_producto)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 6. TABLA: Tickets_Soporte (Contratos con Clientes Virtuales)
-- ----------------------------------------------------------
CREATE TABLE Tickets_Soporte (
    id_ticket INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    teraflops_requeridos INT NOT NULL,
    anchoDeBanda_requerido INT NOT NULL,
    memoriaRequerida INT NOT NULL,
    recompensa_creditos DECIMAL(10, 2) NOT NULL,
    penalizacion_creditos DECIMAL(10, 2) NOT NULL,
    recompensa_reputacion INT NOT NULL,
    penalizacion_reputacion INT NOT NULL,
    estado ENUM('pendiente', 'completado', 'fallido') DEFAULT 'pendiente',
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tickets_usuario
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 7. TABLA: Incidentes_Activos (Eventos Aleatorios)
-- ----------------------------------------------------------
CREATE TABLE Incidentes_Activos (
    id_incidente INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    tipo ENUM('SOBRECALENTAMIENTO', 'ATAQUE_SEGURIDAD', 'SATURACION_RED') NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    accion_requerida VARCHAR(50) NOT NULL,
    penalizacion_creditos DECIMAL(10, 2) DEFAULT 100.00,
    penalizacion_reputacion INT DEFAULT 15,
    recompensa_creditos DECIMAL(10, 2) DEFAULT 80.00,
    recompensa_reputacion INT DEFAULT 10,
    estado ENUM('activo', 'resuelto', 'fallido') DEFAULT 'activo',
    fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_incidentes_usuario
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------
-- 8. TABLA: Historial_Actividad (Bitácora Auditora Docente)
-- ----------------------------------------------------------
CREATE TABLE Historial_Actividad (
    id_historial INT AUTO_INCREMENT PRIMARY KEY,
    id_usuario INT NOT NULL,
    tipo_evento VARCHAR(50) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_historial_usuario
        FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario)
        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ==========================================================
-- DATOS SEMILLA (SEED DATA)
-- ==========================================================

-- Catálogo de Hardware representativo para el MVP
INSERT INTO Catalogo_Productos
  (nombreProducto, categoria, costo, espacioNecesario, aumento_teraflops, impacto_temperatura, aumento_memoria, impacto_anchoDeBanda, consumoElectrico, aumento_watts)
VALUES
  -- Servidores
  ('Dull PowerBorde R110 (1U)', 'Servidor', 250.00, 1, 8, 4, 16, 25, 120, 0),
  ('HachePe ProLiante DL360 (1U)', 'Servidor', 550.00, 1, 22, 8, 64, 50, 220, 0),
  ('Lenorvo OverThink SR650 (2U)', 'Servidor', 1100.00, 2, 45, 14, 128, 100, 380, 0),
  ('HyperMicro MegaBlade X12 (3U)', 'Servidor', 2400.00, 3, 95, 24, 256, 200, 650, 0),
  ('Envidia DGX-9000 TensorHorno (4U)', 'Servidor', 5500.00, 4, 250, 45, 512, 400, 1200, 0),

  -- Refrigeración
  ('NocturnaBúho FanTray Industrial (1U)', 'Refrigeracion', 120.00, 1, 0, -6, 0, 0, 30, 0),
  ('Corsario HydroLeak AIO (1U)', 'Refrigeracion', 220.00, 1, 0, -12, 0, 0, 55, 0),
  ('VertiFrío Liebert InRow (2U)', 'Refrigeracion', 480.00, 2, 0, -24, 0, 0, 130, 0),
  ('TermoTake Chiller H2O-Max (3U)', 'Refrigeracion', 950.00, 3, 0, -42, 0, 0, 260, 0),
  ('SubMarino Pod Dieléctrico (4U)', 'Refrigeracion', 2100.00, 4, 0, -80, 0, 0, 420, 0),

  -- Energía
  ('TrippCorto Regleta PDU-800 (1U)', 'Energia', 140.00, 1, 0, 1, 0, 0, 10, 400),
  ('APagón Smart-UPS 1500VA (2U)', 'Energia', 280.00, 2, 0, 2, 0, 0, 20, 800),
  ('Tragón 9PX Doble Conversión (2U)', 'Energia', 620.00, 2, 0, 4, 0, 0, 35, 1600),
  ('Chispazoneider Symmetra Li-Ion (3U)', 'Energia', 1350.00, 3, 0, 5, 0, 0, 50, 3200),
  ('Tésla MegaPila Nuclear-Pack (4U)', 'Energia', 3200.00, 4, 0, 8, 0, 0, 80, 6500),

  -- Redes
  ('MacroTik RouterBordo HEX-24 (1U)', 'Redes', 150.00, 1, 0, 2, 0, 150, 35, 0),
  ('Chisco Catalizador 2960-Giga (1U)', 'Redes', 240.00, 1, 0, 2, 0, 250, 50, 0),
  ('FuerteNet FortiMuro 600F (2U)', 'Redes', 580.00, 2, 0, 5, 0, 500, 110, 0),
  ('Arisca EtherSwitch 100G-Spine (2U)', 'Redes', 1250.00, 2, 0, 9, 0, 1200, 220, 0),
  ('Junípero PTX-TeraCore Óptico (3U)', 'Redes', 2800.00, 3, 0, 16, 0, 3000, 400, 0);

-- Profesor Administrador Inicial (Password: PasswordDocente2026)
-- Hash generado con bcrypt (10 rounds)
INSERT INTO Profesores (id_profesor, nombre, correo, password_hash)
VALUES (
    1,
    'Profesor Demo',
    'carlos@universidad.edu',
    '$2b$10$tZc4s95/2bVqQ1h2n1L.oOi1c64z2Wq1x96c21e3a9z0y9b4e6d2a'
) ON DUPLICATE KEY UPDATE correo = correo;

-- Clase Demo Inicial
INSERT INTO Clases (id_clase, id_profesor, nombre_clase, codigo_clase, activa)
VALUES (
    1,
    1,
    'Arquitectura y Redes - Grupo A',
    'CT-DEMO1',
    1
) ON DUPLICATE KEY UPDATE codigo_clase = codigo_clase;
