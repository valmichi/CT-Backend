-- Verificación del correo de los docentes con un código enviado por correo.
-- Ejecutar UNA vez en bases creadas antes de este cambio (sirve el ciclo de migraciones).
-- Si dice "Duplicate column name 'verificado'", ya estaba aplicada.
SET NAMES utf8mb4;

ALTER TABLE Profesores
  ADD COLUMN verificado BOOLEAN NOT NULL DEFAULT FALSE AFTER password_hash,
  ADD COLUMN codigo_hash VARCHAR(255) NULL AFTER verificado,
  ADD COLUMN codigo_expira DATETIME NULL AFTER codigo_hash,
  ADD COLUMN codigo_intentos INT NOT NULL DEFAULT 0 AFTER codigo_expira,
  ADD COLUMN codigo_enviado DATETIME NULL AFTER codigo_intentos;

-- Los docentes que ya existían siguen entrando como hasta ahora.
UPDATE Profesores SET verificado = TRUE;
