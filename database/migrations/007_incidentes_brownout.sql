-- Incidentes generados por el servidor (con tiempo límite y opciones) y la
-- falla eléctrica que provoca el apagón parcial (brownout). Ejecutar UNA vez
-- en bases creadas antes de este cambio (sirve el ciclo de migraciones).
-- Si dice "Duplicate column name 'opciones_json'", ya estaba aplicada.
SET NAMES utf8mb4;

ALTER TABLE Incidentes_Activos
  MODIFY COLUMN tipo ENUM('SOBRECALENTAMIENTO', 'ATAQUE_SEGURIDAD', 'SATURACION_RED', 'FALLA_ELECTRICA') NOT NULL,
  ADD COLUMN opciones_json JSON NULL AFTER accion_requerida,
  ADD COLUMN fecha_limite DATETIME NULL AFTER fecha_creacion,
  ADD COLUMN fecha_resolucion DATETIME NULL AFTER fecha_limite;

ALTER TABLE Usuarios
  ADD COLUMN proximo_incidente DATETIME NULL AFTER ultimo_cobro;

-- Incidentes viejos que quedaron activos: se cierran sin penalizar
-- (no tenían opciones ni tiempo límite y no se podían responder desde el juego).
UPDATE Incidentes_Activos SET estado = 'fallido', fecha_resolucion = NOW()
WHERE estado = 'activo' AND fecha_limite IS NULL;
