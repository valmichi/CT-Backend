-- Migración para bases creadas antes de este cambio (init.sql solo corre con
-- el volumen vacío). Ejecutar UNA vez:
--   docker exec -i ct-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 cyber_tycoon' < database/migrations/001_inventario_estado_y_ubicacion.sql
-- Los equipos ya comprados reciben rack/slot automáticamente la próxima vez
-- que el backend recalcula el estado (estado.service.asegurarUbicaciones).
SET NAMES utf8mb4;

ALTER TABLE Inventario_Usuario
  ADD COLUMN encendido BOOLEAN NOT NULL DEFAULT TRUE AFTER id_producto,
  ADD COLUMN rack_numero TINYINT NULL AFTER encendido,
  ADD COLUMN slot_inicio TINYINT NULL AFTER rack_numero;
