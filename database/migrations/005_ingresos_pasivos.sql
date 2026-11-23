-- Ingresos pasivos: momento hasta el que ya se le pagó al jugador lo que generan
-- sus servidores encendidos. Ejecutar UNA vez en bases creadas antes de este
-- cambio (sirve el ciclo "for f in database/migrations/*.sql").
-- Si dice "Duplicate column name 'ultimo_cobro'", ya estaba aplicada.
-- Los usuarios existentes arrancan con la hora de la migración: no se les paga
-- tiempo retroactivo.
SET NAMES utf8mb4;

ALTER TABLE Usuarios
  ADD COLUMN ultimo_cobro DATETIME NULL DEFAULT CURRENT_TIMESTAMP AFTER estado_partida;
