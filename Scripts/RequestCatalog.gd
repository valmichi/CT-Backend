extends RefCounted
class_name RequestCatalog
## Catálogo de solicitudes. Cada solicitante tiene un catálogo FIJO de 50
## solicitudes distintas (CATALOG_SIZE), y cada solicitud pide SOLO productos de
## la tienda: los 20 de PRODUCTS (5 por categoría), con el nombre EXACTO que
## tienen en la tabla Catalogo_Productos.
##
## Por ahora los 10 solicitantes comparten la misma lista base (TEMPLATES).
## Para darle a un solicitante su propio catálogo, agrega su lista de 50 en
## CATALOG_OVERRIDES con el índice del solicitante como llave (0 = av1, 1 = av2...).
## validate() revisa que todo siga cuadrando (50 por solicitante, sin títulos
## repetidos y solo productos de PRODUCTS).
##
## ORDEN Y DIFICULTAD: cada catálogo está ordenado de la solicitud más fácil a la
## más difícil: las primeras 17 son "facil", las siguientes 16 "media" y las
## últimas 17 "dificil". La reputación del jugador decide cuántas puede pedir
## cada cliente (ver unlocked_count): con poca reputación solo salen las fáciles.
##
## Campos de cada solicitud:
##   titulo, dificultad, requiere = {nombre exacto del producto: cantidad},
##   rc / pc = recompensa / penalización en créditos,
##   rr / pr = recompensa / penalización de reputación.
## rc y rr de cada solicitud deben caer dentro del rango de su dificultad
## (REWARD_RANGES); validate() avisa si no.

const CATALOG_SIZE := 50

# Cuántas solicitudes de cada dificultad tiene cada catálogo (17 + 16 + 17 = 50).
const EASY_COUNT := 17
const MEDIUM_COUNT := 16
const HARD_COUNT := 17

# Rango de la recompensa (créditos y reputación) según la dificultad: [mínimo, máximo].
const REWARD_RANGES := {
	"facil": [100, 200],
	"media": [200, 400],
	"dificil": [400, 800],
}

# Reputación necesaria para que los clientes empiecen a pedir cada dificultad.
# Por debajo de MEDIUM_UNLOCK_REPUTATION solo salen las 17 fáciles; desde ahí
# también las 16 medias (33 en total); desde HARD_UNLOCK_REPUTATION, las 50.
const MEDIUM_UNLOCK_REPUTATION := 500
const HARD_UNLOCK_REPUTATION := 1500

# Tiempos de todas las solicitudes (segundos).
const DECISION_SECONDS := 60.0   # para aceptar (si no, caduca y desaparece de la bandeja)
const FULFILL_SECONDS := 120     # una vez aceptada, para entregar lo solicitado

## Los 20 productos de la tienda. La llave es nombreProducto tal cual está en la
## base de datos; "categoria" es el valor del ENUM de Catalogo_Productos y "u"
## el espacioNecesario (el "(2U)" del nombre).
const PRODUCTS := {
	"Dull PowerBorde R110 (1U)": {"categoria": "Servidor", "u": 1},
	"HachePe ProLiante DL360 (1U)": {"categoria": "Servidor", "u": 1},
	"Lenorvo OverThink SR650 (2U)": {"categoria": "Servidor", "u": 2},
	"HyperMicro MegaBlade X12 (3U)": {"categoria": "Servidor", "u": 3},
	"Envidia DGX-9000 TensorHorno (4U)": {"categoria": "Servidor", "u": 4},
	"NocturnaBúho FanTray Industrial (1U)": {"categoria": "Refrigeracion", "u": 1},
	"Corsario HydroLeak AIO (1U)": {"categoria": "Refrigeracion", "u": 1},
	"VertiFrío Liebert InRow (2U)": {"categoria": "Refrigeracion", "u": 2},
	"TermoTake Chiller H2O-Max (3U)": {"categoria": "Refrigeracion", "u": 3},
	"SubMarino Pod Dieléctrico (4U)": {"categoria": "Refrigeracion", "u": 4},
	"TrippCorto Regleta PDU-800 (1U)": {"categoria": "Energia", "u": 1},
	"APagón Smart-UPS 1500VA (2U)": {"categoria": "Energia", "u": 2},
	"Tragón 9PX Doble Conversión (2U)": {"categoria": "Energia", "u": 2},
	"Chispazoneider Symmetra Li-Ion (3U)": {"categoria": "Energia", "u": 3},
	"Tésla MegaPila Nuclear-Pack (4U)": {"categoria": "Energia", "u": 4},
	"MacroTik RouterBordo HEX-24 (1U)": {"categoria": "Redes", "u": 1},
	"Chisco Catalizador 2960-Giga (1U)": {"categoria": "Redes", "u": 1},
	"FuerteNet FortiMuro 600F (2U)": {"categoria": "Redes", "u": 2},
	"Arisca EtherSwitch 100G-Spine (2U)": {"categoria": "Redes", "u": 2},
	"Junípero PTX-TeraCore Óptico (3U)": {"categoria": "Redes", "u": 3},
}

## Cómo se muestra cada categoría en pantalla.
const CATEGORY_LABELS := {
	"Servidor": "Servidores",
	"Refrigeracion": "Refrigeración",
	"Energia": "Energía",
	"Redes": "Redes",
}

const CATALOG_OVERRIDES := {}

const TEMPLATES := [
	{"titulo": "Blog de Noticias Local", "dificultad": "facil", "requiere": {"Dull PowerBorde R110 (1U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1}, "rc": 100, "pc": 35, "rr": 100, "pr": 140},
	{"titulo": "Contener Fuerza Bruta en SSH", "dificultad": "facil", "requiere": {"Chisco Catalizador 2960-Giga (1U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 110, "pc": 35, "rr": 105, "pr": 145},
	{"titulo": "Bloquear Campaña de Phishing", "dificultad": "facil", "requiere": {"MacroTik RouterBordo HEX-24 (1U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 110, "pc": 35, "rr": 110, "pr": 155},
	{"titulo": "Alerta de Intrusión en Firewall", "dificultad": "facil", "requiere": {"Chisco Catalizador 2960-Giga (1U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 120, "pc": 40, "rr": 120, "pr": 170},
	{"titulo": "Sitio Web Corporativo", "dificultad": "facil", "requiere": {"Dull PowerBorde R110 (1U)": 1, "NocturnaBúho FanTray Industrial (1U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1}, "rc": 120, "pc": 40, "rr": 125, "pr": 175},
	{"titulo": "Correo Electrónico Institucional", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "TrippCorto Regleta PDU-800 (1U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 130, "pc": 45, "rr": 130, "pr": 180},
	{"titulo": "Intranet de Recursos Humanos", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "NocturnaBúho FanTray Industrial (1U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1}, "rc": 140, "pc": 45, "rr": 140, "pr": 195},
	{"titulo": "Analizar Malware en Servidor de Correo", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 140, "pc": 45, "rr": 145, "pr": 205},
	{"titulo": "Mitigar Ataque DDoS", "dificultad": "facil", "requiere": {"FuerteNet FortiMuro 600F (2U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 150, "pc": 50, "rr": 150, "pr": 210},
	{"titulo": "Respaldo Nocturno de Archivos", "dificultad": "facil", "requiere": {"Dull PowerBorde R110 (1U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1}, "rc": 160, "pc": 55, "rr": 155, "pr": 215},
	{"titulo": "Tienda en Línea Básica", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "Corsario HydroLeak AIO (1U)": 1, "TrippCorto Regleta PDU-800 (1U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 160, "pc": 55, "rr": 160, "pr": 225},
	{"titulo": "Portal de Citas Médicas", "dificultad": "facil", "requiere": {"Dull PowerBorde R110 (1U)": 1, "NocturnaBúho FanTray Industrial (1U)": 1, "TrippCorto Regleta PDU-800 (1U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 170, "pc": 55, "rr": 170, "pr": 240},
	{"titulo": "Alerta Térmica en el Rack Principal", "dificultad": "facil", "requiere": {"VertiFrío Liebert InRow (2U)": 1, "NocturnaBúho FanTray Industrial (1U)": 2, "TrippCorto Regleta PDU-800 (1U)": 1}, "rc": 180, "pc": 60, "rr": 175, "pr": 245},
	{"titulo": "Sistema de Reservaciones de Hotel", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "Corsario HydroLeak AIO (1U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1}, "rc": 180, "pc": 60, "rr": 180, "pr": 250},
	{"titulo": "Red de Sensores IoT para Fábrica", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 190, "pc": 65, "rr": 190, "pr": 265},
	{"titulo": "Respaldo Cifrado para Despacho Legal", "dificultad": "facil", "requiere": {"HachePe ProLiante DL360 (1U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 190, "pc": 65, "rr": 195, "pr": 275},
	{"titulo": "Hospedaje Web PYME", "dificultad": "facil", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "NocturnaBúho FanTray Industrial (1U)": 1, "TrippCorto Regleta PDU-800 (1U)": 1, "MacroTik RouterBordo HEX-24 (1U)": 1}, "rc": 200, "pc": 65, "rr": 200, "pr": 280},
	{"titulo": "Servidor de Videollamadas", "dificultad": "media", "requiere": {"HachePe ProLiante DL360 (1U)": 2, "Corsario HydroLeak AIO (1U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 200, "pc": 65, "rr": 200, "pr": 280},
	{"titulo": "CRM para Equipo de Ventas", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "Corsario HydroLeak AIO (1U)": 1, "TrippCorto Regleta PDU-800 (1U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 210, "pc": 70, "rr": 215, "pr": 300},
	{"titulo": "Detener Intrusión en Servidor de Archivos", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 230, "pc": 75, "rr": 225, "pr": 315},
	{"titulo": "Base de Datos de Inventario", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "VertiFrío Liebert InRow (2U)": 1, "APagón Smart-UPS 1500VA (2U)": 1}, "rc": 240, "pc": 80, "rr": 240, "pr": 335},
	{"titulo": "Responder a Ransomware en NAS", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 250, "pc": 85, "rr": 255, "pr": 355},
	{"titulo": "Contener Hackeo del Portal Web", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 270, "pc": 90, "rr": 265, "pr": 370},
	{"titulo": "Ataque de Inyección SQL a la Base de Datos", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 280, "pc": 95, "rr": 280, "pr": 390},
	{"titulo": "Centro de Llamadas Virtual", "dificultad": "media", "requiere": {"HachePe ProLiante DL360 (1U)": 2, "Corsario HydroLeak AIO (1U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 290, "pc": 95, "rr": 295, "pr": 415},
	{"titulo": "Plataforma de Cursos en Línea", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "Corsario HydroLeak AIO (1U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 310, "pc": 105, "rr": 305, "pr": 425},
	{"titulo": "Sistema de Facturación Electrónica", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 320, "pc": 105, "rr": 320, "pr": 450},
	{"titulo": "Servidor Universitario de Exámenes", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "Corsario HydroLeak AIO (1U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 330, "pc": 110, "rr": 335, "pr": 470},
	{"titulo": "API de Pagos para Comercio", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 350, "pc": 115, "rr": 345, "pr": 485},
	{"titulo": "Portal Gubernamental de Trámites", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "VertiFrío Liebert InRow (2U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 360, "pc": 120, "rr": 360, "pr": 505},
	{"titulo": "Balanceador de Carga para Ecommerce", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "Corsario HydroLeak AIO (1U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1, "Junípero PTX-TeraCore Óptico (3U)": 1}, "rc": 370, "pc": 125, "rr": 375, "pr": 525},
	{"titulo": "Portal de Telemedicina", "dificultad": "media", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 390, "pc": 130, "rr": 385, "pr": 540},
	{"titulo": "Analítica de Ventas en Tiempo Real", "dificultad": "media", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "VertiFrío Liebert InRow (2U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "Chisco Catalizador 2960-Giga (1U)": 1}, "rc": 400, "pc": 135, "rr": 400, "pr": 560},
	{"titulo": "Almacenamiento de Fotografías", "dificultad": "dificil", "requiere": {"Lenorvo OverThink SR650 (2U)": 2, "VertiFrío Liebert InRow (2U)": 1, "APagón Smart-UPS 1500VA (2U)": 1}, "rc": 400, "pc": 135, "rr": 400, "pr": 560},
	{"titulo": "Recuperación ante Desastres", "dificultad": "dificil", "requiere": {"Lenorvo OverThink SR650 (2U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 420, "pc": 140, "rr": 425, "pr": 595},
	{"titulo": "Servidor Streaming Video", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "VertiFrío Liebert InRow (2U)": 1, "APagón Smart-UPS 1500VA (2U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 450, "pc": 150, "rr": 450, "pr": 630},
	{"titulo": "Migración a Nube Híbrida", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 480, "pc": 160, "rr": 475, "pr": 665},
	{"titulo": "Servidor de Juegos Multijugador", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 500, "pc": 165, "rr": 500, "pr": 700},
	{"titulo": "Plataforma de Trading Bursátil", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Tragón 9PX Doble Conversión (2U)": 1, "Junípero PTX-TeraCore Óptico (3U)": 1}, "rc": 520, "pc": 175, "rr": 525, "pr": 735},
	{"titulo": "Sistema Bancario de Cajeros", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "VertiFrío Liebert InRow (2U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 550, "pc": 185, "rr": 550, "pr": 770},
	{"titulo": "Reconocimiento de Imágenes Médicas", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1}, "rc": 580, "pc": 195, "rr": 575, "pr": 805},
	{"titulo": "Minería de Datos para Banco", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "Lenorvo OverThink SR650 (2U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Tragón 9PX Doble Conversión (2U)": 1}, "rc": 600, "pc": 200, "rr": 600, "pr": 840},
	{"titulo": "Traducción Automática Masiva", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 1, "Lenorvo OverThink SR650 (2U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 620, "pc": 205, "rr": 625, "pr": 875},
	{"titulo": "Análisis Genómico Universitario", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 1, "SubMarino Pod Dieléctrico (4U)": 1, "Tésla MegaPila Nuclear-Pack (4U)": 1}, "rc": 650, "pc": 215, "rr": 650, "pr": 910},
	{"titulo": "Procesamiento IA / ML", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 1, "SubMarino Pod Dieléctrico (4U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1, "Arisca EtherSwitch 100G-Spine (2U)": 1}, "rc": 680, "pc": 225, "rr": 675, "pr": 945},
	{"titulo": "Renderizado de Animación 3D", "dificultad": "dificil", "requiere": {"HyperMicro MegaBlade X12 (3U)": 2, "TermoTake Chiller H2O-Max (3U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1}, "rc": 700, "pc": 235, "rr": 700, "pr": 980},
	{"titulo": "Simulación Climática Regional", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Tésla MegaPila Nuclear-Pack (4U)": 1, "FuerteNet FortiMuro 600F (2U)": 1}, "rc": 720, "pc": 240, "rr": 725, "pr": 1015},
	{"titulo": "Procesamiento de Imágenes Satelitales", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1, "Junípero PTX-TeraCore Óptico (3U)": 1}, "rc": 750, "pc": 250, "rr": 750, "pr": 1050},
	{"titulo": "Plataforma de Ciudad Inteligente", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 1, "TermoTake Chiller H2O-Max (3U)": 1, "Chispazoneider Symmetra Li-Ion (3U)": 1, "Junípero PTX-TeraCore Óptico (3U)": 1}, "rc": 780, "pc": 260, "rr": 775, "pr": 1085},
	{"titulo": "Entrenamiento de Modelo de Lenguaje", "dificultad": "dificil", "requiere": {"Envidia DGX-9000 TensorHorno (4U)": 2, "SubMarino Pod Dieléctrico (4U)": 1, "Tésla MegaPila Nuclear-Pack (4U)": 1}, "rc": 800, "pc": 265, "rr": 800, "pr": 1120},
]


## Dificultad ("facil", "media" o "dificil") de la solicitud en la posición dada.
static func difficulty_of(request_index: int) -> String:
	if request_index < EASY_COUNT:
		return "facil"
	if request_index < EASY_COUNT + MEDIUM_COUNT:
		return "media"
	return "dificil"


## Cuántas solicitudes del catálogo (contando desde la primera) puede pedir un
## cliente con esa reputación: 17, 33 o 50.
static func unlocked_count(reputation: int) -> int:
	if reputation >= HARD_UNLOCK_REPUTATION:
		return CATALOG_SIZE
	if reputation >= MEDIUM_UNLOCK_REPUTATION:
		return EASY_COUNT + MEDIUM_COUNT
	return EASY_COUNT


static func get_catalog(requester_index: int) -> Array:
	if CATALOG_OVERRIDES.has(requester_index):
		var custom: Array = CATALOG_OVERRIDES[requester_index]
		if custom.size() == CATALOG_SIZE:
			return custom
		push_warning("[RequestCatalog] El catálogo del solicitante %d tiene %d solicitudes y debe tener %d; se usa el catálogo base." % [requester_index, custom.size(), CATALOG_SIZE])
	return TEMPLATES


## Revisa que cada solicitante tenga exactamente 50 solicitudes, sin títulos
## repetidos y pidiendo únicamente productos de PRODUCTS (con cantidad >= 1).
static func validate(requester_count: int) -> bool:
	var ok := true
	if PRODUCTS.size() != 20:
		push_error("[RequestCatalog] PRODUCTS debe tener exactamente 20 productos y tiene %d." % PRODUCTS.size())
		ok = false
	for r in requester_count:
		var catalog := get_catalog(r)
		if catalog.size() != CATALOG_SIZE:
			push_error("[RequestCatalog] El solicitante %d no tiene %d solicitudes." % [r, CATALOG_SIZE])
			ok = false
		var seen := {}
		for i in catalog.size():
			var entry: Dictionary = catalog[i]
			if entry.get("dificultad", "") != difficulty_of(i):
				push_error("[RequestCatalog] Solicitante %d, posición %d (\"%s\"): su dificultad debe ser \"%s\" (17 fáciles, 16 medias, 17 difíciles, en ese orden)." % [r, i + 1, entry["titulo"], difficulty_of(i)])
				ok = false
			var rango: Array = REWARD_RANGES.get(difficulty_of(i), [0, 0])
			for campo in ["rc", "rr"]:
				if int(entry[campo]) < rango[0] or int(entry[campo]) > rango[1]:
					push_error("[RequestCatalog] \"%s\": %s = %d fuera del rango %s de su dificultad." % [entry["titulo"], campo, int(entry[campo]), str(rango)])
					ok = false
			if seen.has(entry["titulo"]):
				push_error("[RequestCatalog] Título repetido en el solicitante %d: %s" % [r, entry["titulo"]])
				ok = false
			seen[entry["titulo"]] = true
			var requiere: Dictionary = entry["requiere"]
			if requiere.is_empty():
				push_error("[RequestCatalog] La solicitud \"%s\" no pide ningún producto." % entry["titulo"])
				ok = false
			for producto in requiere:
				if not PRODUCTS.has(producto):
					push_error("[RequestCatalog] \"%s\" pide un producto que no es de la tienda: %s" % [entry["titulo"], producto])
					ok = false
				if int(requiere[producto]) < 1:
					push_error("[RequestCatalog] \"%s\" pide cantidad inválida de %s" % [entry["titulo"], producto])
					ok = false
	return ok


static func make_ticket_data(requester_index: int, request_index: int) -> TicketData:
	var entry: Dictionary = get_catalog(requester_index)[request_index]
	var data := TicketData.new()
	data.titulo = entry["titulo"]
	data.descripcion = entry["titulo"]
	data.dificultad = entry["dificultad"]
	data.productos_requeridos = (entry["requiere"] as Dictionary).duplicate()
	data.recompensa_creditos = float(entry["rc"])
	data.penalizacion_creditos = float(entry["pc"])
	data.recompensa_reputacion = int(entry["rr"])
	data.penalizacion_reputacion = int(entry["pr"])
	data.decision_time_seconds = DECISION_SECONDS
	data.tiempo_para_completado = FULFILL_SECONDS
	data.requester_index = requester_index
	data.request_index = request_index
	return data
