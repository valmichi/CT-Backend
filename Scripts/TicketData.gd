extends Resource
class_name TicketData
## Espeja una fila real de Tickets_Soporte tal como la regresa
## GET /api/tickets/pendientes (ver src/routes/tickets.routes.js del backend).

@export var id_ticket: int = 0
# La tabla solo trae "descripcion" (en la práctica es el nombre corto del
# contrato, ej. "Hospedaje Web PYME"). Helpdesk.gd lo usa como título y arma
# el texto "detalle" con las recompensas/penalizaciones reales del ticket.
@export var descripcion: String = ""
@export var titulo: String = ""
@export var detalle: String = ""
@export var icon: Texture2D # avatar del solicitante (av1.png ... av10.png)
@export var solicitante: String = "" # nombre de quien pide/reporta el ticket

@export var teraflops_requeridos: float = 0.0
@export var anchoDeBanda_requerido: float = 0.0
@export var memoriaRequerida: float = 0.0

@export var recompensa_creditos: float = 0.0
@export var penalizacion_creditos: float = 0.0
@export var recompensa_reputacion: int = 0
@export var penalizacion_reputacion: int = 0

@export var fecha_limite: String = ""       # datetime ISO que regresa MySQL
@export var tiempo_para_completado: int = 30 # segundos, viene de "tiempoParaCompletado"

# Este NO viene de la API: se calcula localmente en Helpdesk.gd restando
# fecha_limite menos la hora actual, solo para pintar el cronómetro de
# decisión. El servidor sigue siendo quien de verdad valida los tiempos.
@export var decision_time_seconds: float = 15.0


## Muestra 150.0 como "150" y 4.5 como "4.5" (para las etiquetas de la UI).
static func fmt_num(value: float) -> String:
	if is_equal_approx(value, roundf(value)):
		return str(int(value))
	return "%.1f" % value
