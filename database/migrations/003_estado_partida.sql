-- Agrega el estado de la partida (ACTIVE / GAME_OVER) y acota la reputación a
-- [0, 100]. Ejecutar UNA vez en bases creadas antes de este cambio (se puede
-- correr junto con las demás con el ciclo "for f in database/migrations/*.sql").
-- Si dice "Duplicate column name 'estado_partida'", ya estaba aplicada.
SET NAMES utf8mb4;

ALTER TABLE Usuarios
  ADD COLUMN estado_partida ENUM('ACTIVE', 'GAME_OVER') NOT NULL DEFAULT 'ACTIVE' AFTER reputacion;

UPDATE Usuarios SET reputacion = LEAST(100, GREATEST(0, reputacion));
UPDATE Usuarios SET estado_partida = 'GAME_OVER' WHERE reputacion = 0;
