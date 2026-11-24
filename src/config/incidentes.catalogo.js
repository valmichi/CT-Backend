// Incidentes del Data Center y las acciones que el jugador puede elegir.
// El servidor nunca revela cuál es la correcta: al cliente le llegan las
// opciones (la correcta + distractores) en orden al azar.

// Todas las acciones posibles (id que viaja en la API + texto para el botón).
const ACCIONES = Object.freeze({
  ACTIVAR_REFRIGERACION_EMERGENCIA: 'Activar refrigeración de emergencia',
  BLOQUEAR_IPS_FIREWALL: 'Bloquear las IPs en el firewall',
  BALANCEAR_CARGA_QOS: 'Balancear la carga con QoS',
  CAMBIAR_ENERGIA_RESPALDO: 'Cambiar a la energía de respaldo (UPS)',
  REINICIAR_TODOS_LOS_SERVIDORES: 'Reiniciar todos los servidores',
  ABRIR_PUERTOS_DEL_FIREWALL: 'Abrir los puertos del firewall',
  DESACTIVAR_RESPALDOS: 'Desactivar los respaldos automáticos',
  IGNORAR_ALERTA: 'Ignorar la alerta'
});

const INCIDENTES = Object.freeze([
  {
    tipo: 'SOBRECALENTAMIENTO',
    titulo: 'Alerta térmica',
    descripcion: 'Los sensores del Rack 1 superaron el umbral crítico de temperatura.',
    accion_requerida: 'ACTIVAR_REFRIGERACION_EMERGENCIA',
    recompensa_creditos: 100,
    penalizacion_creditos: 150
  },
  {
    tipo: 'ATAQUE_SEGURIDAD',
    titulo: 'Ataque de fuerza bruta',
    descripcion: 'Miles de intentos de acceso por SSH desde las mismas direcciones IP.',
    accion_requerida: 'BLOQUEAR_IPS_FIREWALL',
    recompensa_creditos: 150,
    penalizacion_creditos: 200
  },
  {
    tipo: 'SATURACION_RED',
    titulo: 'Saturación de red',
    descripcion: 'Tráfico anómalo provoca un cuello de botella en los switches core.',
    accion_requerida: 'BALANCEAR_CARGA_QOS',
    recompensa_creditos: 80,
    penalizacion_creditos: 120
  },
  {
    tipo: 'FALLA_ELECTRICA',
    titulo: 'Falla en la red eléctrica',
    descripcion: 'Una caída de voltaje redujo la energía disponible: el Data Center no puede alimentar todo el equipo.',
    accion_requerida: 'CAMBIAR_ENERGIA_RESPALDO',
    recompensa_creditos: 120,
    penalizacion_creditos: 150
  }
]);

module.exports = { ACCIONES, INCIDENTES };
