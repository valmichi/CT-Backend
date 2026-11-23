-- Zona crítica de temperatura (> 85 °C): el apagado de emergencia marca los
-- equipos que apagó el servidor con motivo_apagado = 'OVERHEATED' (NULL = lo
-- apagó/encendió el jugador). Ejecutar UNA vez en bases creadas antes de este
-- cambio (sirve el ciclo "for f in database/migrations/*.sql").
-- Si dice "Duplicate column name 'motivo_apagado'", ya estaba aplicada.
SET NAMES utf8mb4;

ALTER TABLE Inventario_Usuario
  ADD COLUMN motivo_apagado VARCHAR(20) NULL DEFAULT NULL AFTER encendido;
