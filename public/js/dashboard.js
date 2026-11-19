// Usamos sessionStorage para que la sesión se destruya al cerrar pestaña/navegador
let tokenDocente = sessionStorage.getItem('tokenDocente') || '';
let listaAlumnosActuales = [];
let timerAutoRefresh = null;

// Control de cierre automático por inactividad (15 minutos)
const TIEMPO_INACTIVIDAD_MS = 15 * 60 * 1000;
let timerInactividad = null;

// Sanitizador contextual defensivo para el renderizado seguro en DOM
function escaparHTML(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Interceptor centralizado para peticiones autenticadas
async function fetchAutenticado(url, opciones = {}) {
  opciones.headers = opciones.headers || {};
  opciones.headers['Authorization'] = 'Bearer ' + tokenDocente;

  const res = await fetch(url, opciones);

  // Si el token expiró en el backend o no es válido (401 / 403)
  if (res.status === 401 || res.status === 403) {
    alert('Tu sesión ha expirado o no es válida. Por favor inicia sesión nuevamente.');
    cerrarSesion();
    throw new Error('Sesión expirada');
  }

  return res;
}

// Detección de actividad del usuario
function reiniciarTemporizadorInactividad() {
  if (!tokenDocente) return;

  if (timerInactividad) clearTimeout(timerInactividad);

  timerInactividad = setTimeout(() => {
    alert('Sesión cerrada automáticamente por inactividad (15 minutos).');
    cerrarSesion();
  }, TIEMPO_INACTIVIDAD_MS);
}

function iniciarMonitoreoInactividad() {
  const eventos = ['mousemove', 'keydown', 'click', 'scroll'];
  eventos.forEach(evento => {
    window.addEventListener(evento, reiniciarTemporizadorInactividad);
  });
  reiniciarTemporizadorInactividad();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tabBtnLogin').addEventListener('click', () => cambiarTab('login'));
  document.getElementById('tabBtnRegistro').addEventListener('click', () => cambiarTab('registro'));
  document.getElementById('btnIniciarSesion').addEventListener('click', iniciarSesionDocente);
  document.getElementById('btnRegistrarDocente').addEventListener('click', registrarNuevoDocente);
  document.getElementById('btnAutoRefresh').addEventListener('click', toggleAutoRefresh);
  document.getElementById('btnCerrarSesion').addEventListener('click', cerrarSesion);
  document.getElementById('btnCrearClase').addEventListener('click', crearClase);
  document.getElementById('selectClases').addEventListener('change', cargarEstudiantes);
  document.getElementById('btnEliminarClase').addEventListener('click', eliminarClaseSeleccionada);
  document.getElementById('btnAgregarAlumno').addEventListener('click', agregarAlumno);
  document.getElementById('btnRefrescarAhora').addEventListener('click', cargarEstudiantes);
  document.getElementById('inputBuscador').addEventListener('input', filtrarAlumnos);
  document.getElementById('selectFiltroEstado').addEventListener('change', filtrarAlumnos);

  if (tokenDocente) {
    mostrarDashboard();
  }
});

function cambiarTab(tab) {
  document.getElementById('authError').innerText = '';
  document.getElementById('authSuccess').innerText = '';
  if (tab === 'login') {
    document.getElementById('formLogin').classList.remove('hidden');
    document.getElementById('formRegistro').classList.add('hidden');
    document.getElementById('tabBtnLogin').classList.add('active');
    document.getElementById('tabBtnRegistro').classList.remove('active');
  } else {
    document.getElementById('formLogin').classList.add('hidden');
    document.getElementById('formRegistro').classList.remove('hidden');
    document.getElementById('tabBtnLogin').classList.remove('active');
    document.getElementById('tabBtnRegistro').classList.add('active');
  }
}

async function registrarNuevoDocente() {
  const nombre = document.getElementById('regNombre').value.trim();
  const correo = document.getElementById('regCorreo').value.trim();
  const password = document.getElementById('regPass').value;
  const clave_maestra = document.getElementById('regClaveMaestra').value.trim();
  const errBox = document.getElementById('authError');
  const succBox = document.getElementById('authSuccess');

  errBox.innerText = '';
  succBox.innerText = '';

  if (!nombre || !correo || !password || !clave_maestra) {
    errBox.innerText = 'Todos los campos son obligatorios.';
    return;
  }

  try {
    const res = await fetch('/api/profesor/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, correo, password, clave_maestra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrar');

    succBox.innerText = '¡Docente registrado con éxito! Inicia sesión.';
    setTimeout(() => {
      cambiarTab('login');
      document.getElementById('loginCorreo').value = correo;
      document.getElementById('loginPass').value = '';
    }, 1200);
  } catch (err) {
    errBox.innerText = err.message;
  }
}

async function iniciarSesionDocente() {
  const correo = document.getElementById('loginCorreo').value.trim();
  const password = document.getElementById('loginPass').value;
  const errBox = document.getElementById('authError');
  errBox.innerText = '';

  try {
    const res = await fetch('/api/profesor/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    tokenDocente = data.token;
    sessionStorage.setItem('tokenDocente', tokenDocente);
    mostrarDashboard();
  } catch (err) {
    errBox.innerText = err.message;
  }
}

function mostrarDashboard() {
  document.getElementById('vistaAuth').classList.add('hidden');
  document.getElementById('vistaDashboard').classList.remove('hidden');
  iniciarMonitoreoInactividad();
  cargarClases();
}

function cerrarSesion() {
  if (timerAutoRefresh) clearInterval(timerAutoRefresh);
  if (timerInactividad) clearTimeout(timerInactividad);
  sessionStorage.removeItem('tokenDocente');
  tokenDocente = '';
  location.reload();
}

function toggleAutoRefresh() {
  const btn = document.getElementById('btnAutoRefresh');
  if (timerAutoRefresh) {
    clearInterval(timerAutoRefresh);
    timerAutoRefresh = null;
    btn.innerText = 'Auto-refresco: OFF';
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-secondary');
  } else {
    timerAutoRefresh = setInterval(cargarEstudiantes, 8000);
    btn.innerText = 'Auto-refresco: ON (8s)';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-danger');
  }
}

async function cargarClases() {
  const select = document.getElementById('selectClases');
  select.innerHTML = '<option value="">Cargando clases...</option>';
  try {
    const res = await fetchAutenticado('/api/profesor/clases');
    const clases = await res.json();
    select.innerHTML = '';

    if (!clases || clases.length === 0) {
      select.innerHTML = '<option value="">No tienes aulas creadas. Crea una.</option>';
      resetearMetricas();
      return;
    }

    clases.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id_clase;
      opt.innerText = `${c.nombre_clase} — Código: [${c.codigo_clase}]`;
      select.appendChild(opt);
    });

    cargarEstudiantes();
  } catch (err) {
    if (err.message !== 'Sesión expirada') {
      select.innerHTML = '<option value="">Error al cargar clases</option>';
    }
  }
}

async function crearClase() {
  const input = document.getElementById('inputNombreClase');
  const nombre = input.value.trim();
  if (!nombre) return alert('Ingresa un nombre para la clase');

  try {
    const res = await fetchAutenticado('/api/profesor/clases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre_clase: nombre })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'No se pudo crear la clase');

    alert(`Clase creada con éxito. Código de clase: ${data.codigo_clase}`);
    input.value = '';
    await cargarClases();
  } catch (err) {
    console.error(err);
  }
}

async function eliminarClaseSeleccionada() {
  const idClase = document.getElementById('selectClases').value;
  if (!idClase) return alert('Selecciona una clase');

  if (!confirm('¿Seguro que deseas eliminar esta aula? Se borrarán todos los estudiantes y sus Data Centers.')) {
    return;
  }

  try {
    const res = await fetchAutenticado(`/api/profesor/clases/${idClase}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Error al eliminar');

    alert(data.mensaje);
    cargarClases();
  } catch (err) {
    console.error(err);
  }
}

async function agregarAlumno() {
  const idClase = document.getElementById('selectClases').value;
  const input = document.getElementById('inputNombreAlumno');
  const msg = document.getElementById('msgAlumno');
  const alias = input.value.trim();

  if (!idClase) return alert('Selecciona un aula primero');
  if (!alias) return alert('Ingresa el alias del alumno');

  msg.innerText = 'Registrando...';
  msg.style.color = 'var(--primary)';

  try {
    const res = await fetchAutenticado(`/api/profesor/clases/${idClase}/estudiantes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombreUsuario: alias })
    });
    const data = await res.json();

    if (!res.ok) {
      msg.innerText = data.error || 'Error al agregar estudiante';
      msg.style.color = 'var(--danger)';
      return;
    }

    msg.innerText = `Estudiante "${data.nombreUsuario}" dado de alta. Ya puede acceder desde Godot.`;
    msg.style.color = 'var(--success)';
    input.value = '';
    cargarEstudiantes();
  } catch (err) {
    console.error(err);
  }
}

async function eliminarAlumno(idUsuario, nombre) {
  if (!confirm(`¿Eliminar al estudiante "${nombre}" y todo su progreso?`)) return;

  try {
    const res = await fetchAutenticado(`/api/profesor/estudiantes/${idUsuario}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'No se pudo eliminar');

    cargarEstudiantes();
  } catch (err) {
    console.error(err);
  }
}

async function cargarEstudiantes() {
  const idClase = document.getElementById('selectClases').value;
  if (!idClase) {
    resetearMetricas();
    return;
  }

  try {
    const res = await fetchAutenticado(`/api/profesor/clases/${idClase}/alumnos`);
    const alumnos = await res.json();

    listaAlumnosActuales = Array.isArray(alumnos) ? alumnos : [];
    actualizarMetricasKPI(listaAlumnosActuales);
    filtrarAlumnos();
  } catch (err) {
    if (err.message !== 'Sesión expirada') {
      document.getElementById('tablaAlumnosBody').innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--danger);">Error al consultar alumnos.</td></tr>';
    }
  }
}

function actualizarMetricasKPI(alumnos) {
  const total = alumnos.length;
  document.getElementById('kpiTotalAlumnos').innerText = total;

  if (total === 0) {
    resetearMetricas();
    return;
  }

  let enRiesgo = 0;
  let sumaTflops = 0;
  let sumaReputacion = 0;

  alumnos.forEach(a => {
    if (a.temperaturaCD > 60 || a.carga_electrica_actual > a.capacidad_watts) {
      enRiesgo++;
    }
    sumaTflops += (a.teraflopsCD || 0);
    sumaReputacion += (a.reputacion || 0);
  });

  document.getElementById('kpiRiesgo').innerText = enRiesgo;
  document.getElementById('kpiTflopsTotal').innerHTML = `${sumaTflops} <span style="font-size: 14px;">TFLOPS</span>`;
  document.getElementById('kpiReputacionPromedio').innerHTML = `${Math.round(sumaReputacion / total)} <span style="font-size: 14px;">pts</span>`;
}

function resetearMetricas() {
  document.getElementById('kpiTotalAlumnos').innerText = '0';
  document.getElementById('kpiRiesgo').innerText = '0';
  document.getElementById('kpiTflopsTotal').innerHTML = '0 <span style="font-size: 14px;">TFLOPS</span>';
  document.getElementById('kpiReputacionPromedio').innerHTML = '0 <span style="font-size: 14px;">pts</span>';
  document.getElementById('tablaAlumnosBody').innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--sub);">No hay estudiantes registrados.</td></tr>';
}

function filtrarAlumnos() {
  const query = document.getElementById('inputBuscador').value.toLowerCase().trim();
  const filtroEstado = document.getElementById('selectFiltroEstado').value;
  const tbody = document.getElementById('tablaAlumnosBody');
  const txtCount = document.getElementById('txtResultadosFiltro');

  if (!listaAlumnosActuales || listaAlumnosActuales.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--sub);">No hay estudiantes en esta clase.</td></tr>';
    txtCount.innerText = '';
    return;
  }

  const filtrados = listaAlumnosActuales.filter(a => {
    const coincideNombre = a.nombreUsuario.toLowerCase().includes(query);
    if (!coincideNombre) return false;

    if (filtroEstado === 'RIESGO') return (a.temperaturaCD > 60 || a.carga_electrica_actual > a.capacidad_watts);
    if (filtroEstado === 'OPTIMO') return (a.temperaturaCD <= 40 && a.carga_electrica_actual <= a.capacidad_watts);
    return true;
  });

  txtCount.innerText = `Mostrando ${filtrados.length} de ${listaAlumnosActuales.length}`;

  if (filtrados.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--sub);">No se encontraron estudiantes con esos criterios.</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  filtrados.forEach(a => {
    let tempClass = 'badge-ok';
    if (a.temperaturaCD > 60) tempClass = 'badge-danger';
    else if (a.temperaturaCD > 40) tempClass = 'badge-warn';

    let wattsClass = (a.carga_electrica_actual > a.capacidad_watts) ? 'color: var(--danger); font-weight: bold;' : '';

    const safeNombre = escaparHTML(a.nombreUsuario);
    const safeId = parseInt(a.id_usuario, 10);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>#${safeId}</td>
      <td><strong>${safeNombre}</strong></td>
      <td>$${Number(a.creditos).toFixed(2)}</td>
      <td>${Number(a.reputacion)} pts</td>
      <td>${Number(a.teraflopsCD)} TF</td>
      <td><span class="badge ${tempClass}">${Number(a.temperaturaCD)} °C</span></td>
      <td style="${wattsClass}">${Number(a.carga_electrica_actual)} / ${Number(a.capacidad_watts)} W</td>
      <td>${Number(a.contratos_finalizados) || 0}</td>
      <td>${Number(a.ataquesResueltos) || 0}</td>
      <td>
        <button class="btn btn-danger btn-eliminar-alumno" style="padding: 3px 8px; font-size: 11px;">Borrar</button>
      </td>
    `;

    tr.querySelector('.btn-eliminar-alumno').addEventListener('click', () => {
      eliminarAlumno(safeId, safeNombre);
    });

    tbody.appendChild(tr);
  });
}
