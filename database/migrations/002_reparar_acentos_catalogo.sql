-- Repara los nombres del catálogo que quedaron con acentos corruptos
-- ("NocturnaBÃºho" en vez de "NocturnaBúho") porque init.sql se ejecutó con el
-- cliente mysql en latin1. Solo toca filas que tengan la marca "Ã" de doble
-- codificación, así que es seguro ejecutarlo aunque la base ya esté bien.
--   docker exec -i ct-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 cyber_tycoon' < database/migrations/002_reparar_acentos_catalogo.sql
SET NAMES utf8mb4;

UPDATE Catalogo_Productos
SET nombreProducto = CONVERT(CAST(CONVERT(nombreProducto USING latin1) AS BINARY) USING utf8mb4)
WHERE nombreProducto COLLATE utf8mb4_bin LIKE '%Ã%';
