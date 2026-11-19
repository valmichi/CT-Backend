extends RefCounted
class_name Session
## Punto único donde vivirá el token del jugador autenticado.
## TODO: cuando exista Login.tscn, ahí es donde se debe escribir
## Session.jwt_token = <token que regrese POST /api/auth/login>.
## Mientras jwt_token esté vacío, Helpdesk.gd y TicketCard.gd caen
## automáticamente a datos de prueba en vez de fallar feo con un 401.

static var jwt_token: String = ""
static var base_url: String = "http://localhost:3000" # TODO: ajustar según dónde corra el backend


static func auth_headers() -> PackedStringArray:
	return PackedStringArray([
		"Content-Type: application/json",
		"Authorization: Bearer %s" % jwt_token
	])
