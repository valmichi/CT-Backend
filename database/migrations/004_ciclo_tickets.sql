-- Ciclo completo de tickets: aceptar (reserva capacidad), rechazar, expirar y
-- entregar con tiempos guardados en el servidor. Ejecutar UNA vez en bases
-- creadas antes de este cambio (sirve el ciclo "for f in database/migrations/*.sql").
-- Si dice "Duplicate column name 'dificultad'", ya estaba aplicada.
SET NAMES utf8mb4;

ALTER TABLE Tickets_Soporte
  MODIFY COLUMN estado ENUM('pendiente', 'en_proceso', 'completado', 'fallido', 'rechazado', 'expirado') DEFAULT 'pendiente',
  ADD COLUMN dificultad ENUM('facil', 'media', 'dificil') NULL AFTER estado,
  ADD COLUMN requiere_json JSON NULL AFTER dificultad,
  ADD COLUMN solicitante TINYINT NULL AFTER requiere_json,
  ADD COLUMN fecha_limite DATETIME NULL AFTER fecha_creacion,
  ADD COLUMN tiempo_proceso_seg INT NOT NULL DEFAULT 120 AFTER fecha_limite,
  ADD COLUMN fecha_aceptado DATETIME NULL AFTER tiempo_proceso_seg,
  ADD COLUMN fecha_entrega DATETIME NULL AFTER fecha_aceptado,
  ADD COLUMN fecha_resolucion DATETIME NULL AFTER fecha_entrega,
  ADD INDEX idx_tickets_usuario_estado (id_usuario, estado);

-- Los pendientes viejos no tenían fecha límite: se les dan 10 minutos de gracia
-- para que no expiren (y quiten reputación) en cuanto se actualice el servidor.
UPDATE Tickets_Soporte SET fecha_limite = NOW() + INTERVAL 10 MINUTE
WHERE estado = 'pendiente' AND fecha_limite IS NULL;
