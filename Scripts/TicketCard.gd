extends Control
class_name TicketCard
## Va sobre el nodo raíz de Escenas/Tickets/TicketCard.tscn.
## Una misma tarjeta con dos "caras":
##   - Collapsed -> ticketSoli.png  (ícono de correo + título + tiempo)
##   - Expanded  -> ticketConte.png (avatar, título, tiempo, descripción,
##                                   requisitos, cronómetro de proceso y botones)
## Un clic en el encabezado alterna entre las dos (acordeón).

signal ticket_accepted(id_ticket: int)
signal ticket_rejected(id_ticket: int)
signal ticket_expired(id_ticket: int)
signal ticket_resolved(id_ticket: int, exito: bool, creditos_actuales: float, reputacion_actual: float)

## REQUEST     = solicitud esperando que el jugador acepte o rechace
## IN_PROGRESS = aceptada, corriendo el cronómetro de proceso
## DONE        = ya resuelta (éxito, fallo o error de red)
enum State { REQUEST, IN_PROGRESS, DONE }

const RESOLVER_ENDPOINT := "/api/tickets/resolver"
const COLLAPSED_HEIGHT := 130.0 # alto de ticketSoli.png
const EXPANDED_HEIGHT := 290.0  # alto de ticketConte.png
const URGENT_SECONDS := 5.0

const COLOR_NORMAL := Color(0.89, 0.93, 0.97)
const COLOR_DIM := Color(0.55, 0.62, 0.7)
const COLOR_URGENT := Color(1.0, 0.35, 0.35)
const COLOR_OK := Color(0.3, 0.9, 0.45)
const COLOR_FAIL := Color(1.0, 0.4, 0.4)

var state: State = State.REQUEST
var result_text: String = ""          # "RESUELTO", "FALLIDO" o "ERROR 401"...
var finished_with_error: bool = false

var _data: TicketData
var _is_expanded: bool = false

@onready var _collapsed: NinePatchRect = %Collapsed
@onready var _expanded: NinePatchRect = %Expanded

@onready var _c_title: Label = %CollapsedTitle
@onready var _c_time: Label = %CollapsedTime
@onready var _c_toggle: TextureButton = %CollapsedToggle

@onready var _avatar: TextureRect = %Avatar
@onready var _e_title: Label = %ExpandedTitle
@onready var _e_time: Label = %ExpandedTime
@onready var _e_toggle: TextureButton = %ExpandedToggle
@onready var _description_label: Label = %DescriptionLabel
@onready var _requirements_label: Label = %RequirementsLabel
@onready var _process_label: Label = %ProcessLabel
@onready var _accept_button: TextureButton = %AcceptButton
@onready var _reject_button: TextureButton = %RejectButton

@onready var _decision_timer: Timer = $DecisionTimer
@onready var _process_timer: Timer = $ProcessTimer
@onready var _resolve_request: HTTPRequest = $ResolveRequest


func _ready() -> void:
	_c_toggle.pressed.connect(_toggle_expanded)
	_e_toggle.pressed.connect(_toggle_expanded)
	_accept_button.pressed.connect(_on_accept_pressed)
	_reject_button.pressed.connect(_on_reject_pressed)
	_decision_timer.timeout.connect(_on_decision_timer_timeout)
	_process_timer.timeout.connect(_on_process_timer_timeout)
	_resolve_request.request_completed.connect(_on_resolve_completed)

	_process_label.visible = false
	_set_expanded(false)


func setup(data: TicketData) -> void:
	_data = data
	var title := data.titulo if not data.titulo.is_empty() else data.descripcion
	var detail := data.detalle if not data.detalle.is_empty() else data.descripcion

	_c_title.text = title
	_e_title.text = title
	_description_label.text = detail
	_requirements_label.text = "Requiere:  Teraflops %s   |   Ancho de banda %s   |   Memoria %s" % [
		TicketData.fmt_num(data.teraflops_requeridos),
		TicketData.fmt_num(data.anchoDeBanda_requerido),
		TicketData.fmt_num(data.memoriaRequerida)
	]
	if data.icon:
		_avatar.texture = data.icon

	_decision_timer.start(data.decision_time_seconds)
	_update_labels()


func get_title() -> String:
	return _c_title.text


func _process(_delta: float) -> void:
	_update_labels()


func _format_time(seconds: float) -> String:
	var total := int(ceil(seconds))
	return "%02d:%02d" % [int(total / 60.0), total % 60]


func _update_labels() -> void:
	if _data == null:
		return
	match state:
		State.REQUEST:
			var left := _decision_timer.time_left
			var color := COLOR_URGENT if left <= URGENT_SECONDS else COLOR_NORMAL
			_set_time_labels(_format_time(left), color, _format_time(left), color)
		State.IN_PROGRESS:
			var txt := _format_time(_process_timer.time_left)
			_set_time_labels(txt, COLOR_NORMAL, "--:--", COLOR_DIM)
			_process_label.text = "Procesando: " + txt
		State.DONE:
			pass # el texto final se fija una sola vez en _finish()


func _set_time_labels(c_text: String, c_color: Color, e_text: String, e_color: Color) -> void:
	_c_time.text = c_text
	_c_time.add_theme_color_override("font_color", c_color)
	_e_time.text = e_text
	_e_time.add_theme_color_override("font_color", e_color)


# --- Acordeón ---

func _toggle_expanded() -> void:
	_set_expanded(not _is_expanded)


func _set_expanded(value: bool) -> void:
	_is_expanded = value
	_collapsed.visible = not value
	_expanded.visible = value
	custom_minimum_size.y = EXPANDED_HEIGHT if value else COLLAPSED_HEIGHT


# --- Botones ---

func _on_accept_pressed() -> void:
	if state != State.REQUEST:
		return
	state = State.IN_PROGRESS
	_decision_timer.stop()
	_process_timer.start(_data.tiempo_para_completado)
	_process_label.visible = true
	_refresh_buttons()
	ticket_accepted.emit(_data.id_ticket)


func _on_reject_pressed() -> void:
	if state != State.REQUEST:
		return
	_decision_timer.stop()
	# TODO: el backend todavía NO tiene un endpoint de "rechazar" (solo existe
	# /api/tickets/resolver, que siempre evalúa capacidad). La penalización de
	# -5 reputación de la spec no se está aplicando de verdad todavía; hace
	# falta pedir al equipo de backend algo como
	# POST /api/tickets/descartar { id_ticket }.
	ticket_rejected.emit(_data.id_ticket)
	queue_free()


func _refresh_buttons() -> void:
	var can_decide := state == State.REQUEST
	_accept_button.disabled = not can_decide
	_reject_button.disabled = not can_decide
	# Ya resuelto: los botones dejan de tener sentido.
	_accept_button.visible = state != State.DONE
	_reject_button.visible = state != State.DONE


# --- Cronómetros ---

func _on_decision_timer_timeout() -> void:
	if state != State.REQUEST:
		return
	# TODO: mismo caso que el rechazo, no existe todavía un endpoint de
	# "caducó" que aplique los -20 de reputación de la spec en el servidor.
	ticket_expired.emit(_data.id_ticket)
	queue_free()


func _on_process_timer_timeout() -> void:
	if state != State.IN_PROGRESS:
		return
	# Aquí es cuando de verdad se le pregunta al servidor si tenías
	# capacidad suficiente. Antes de esto, nada se da por hecho.
	if Session.jwt_token.is_empty():
		# Solo para poder probar la pantalla sin Login.tscn: resultado simulado.
		push_warning("[TicketCard] Sin sesión activa, resultado SIMULADO para el ticket %d" % _data.id_ticket)
		_finish(true, 0.0, 0.0)
		return

	var url := Session.base_url + RESOLVER_ENDPOINT
	var body := JSON.stringify({"id_ticket": _data.id_ticket})
	_resolve_request.request(url, Session.auth_headers(), HTTPClient.METHOD_POST, body)


func _on_resolve_completed(_result: int, response_code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if response_code != 200:
		push_warning("[TicketCard] Error %d al resolver el ticket %d" % [response_code, _data.id_ticket])
		_finish(false, 0.0, 0.0, "ERROR %d" % response_code)
		return

	var json = JSON.parse_string(body.get_string_from_utf8())
	if json == null:
		push_warning("[TicketCard] Respuesta inválida al resolver el ticket %d" % _data.id_ticket)
		_finish(false, 0.0, 0.0, "ERROR")
		return

	_finish(
		bool(json.get("exito", false)),
		float(json.get("creditosActuales", 0.0)),
		float(json.get("reputacionActual", 0.0))
	)


## Deja la tarjeta en su estado final (colapsada, con el resultado a la vista)
## y avisa a Helpdesk para que la mueva a la pestaña "Completados".
func _finish(exito: bool, creditos: float, reputacion: float, error_text: String = "") -> void:
	state = State.DONE
	finished_with_error = not error_text.is_empty()
	result_text = error_text if finished_with_error else ("RESUELTO" if exito else "FALLIDO")
	var color := COLOR_OK if (exito and not finished_with_error) else COLOR_FAIL

	_decision_timer.stop()
	_process_timer.stop()
	_set_time_labels(result_text, color, "--:--", COLOR_DIM)
	_process_label.text = result_text
	_process_label.add_theme_color_override("font_color", color)
	_process_label.visible = true
	_refresh_buttons()
	_set_expanded(false)

	ticket_resolved.emit(_data.id_ticket, exito, creditos, reputacion)
