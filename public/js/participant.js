const socket = window.Nuvens.createSocket();
const text = document.querySelector('#cloudText');
const counter = document.querySelector('#counter');
const statusEl = document.querySelector('#status');
const createButton = document.querySelector('#createCloud');
const controls = ['x', 'y', 'scale', 'distance', 'density', 'drift', 'luminosity', 'shadowMass'].reduce((acc, id) => {
  acc[id] = document.querySelector(`#${id}`);
  return acc;
}, {});
let activeCloud = null;

function payloadFromControls() {
  return {
    text: window.Nuvens.sanitizeText(text.value),
    x: controls.x.value,
    y: controls.y.value,
    scale: controls.scale.value,
    distance: controls.distance.value,
    density: controls.density.value,
    drift: controls.drift.value,
    luminosity: controls.luminosity.value,
    shadowMass: controls.shadowMass.value,
  };
}

function setStatus(message) {
  statusEl.textContent = message;
}

socket.on('connect', () => {
  setStatus('conectado');
  socket.emit('agent:join');
});
socket.on('disconnect', () => setStatus('reconectando…'));
socket.io.on('reconnect', () => {
  socket.emit('agent:join');
  socket.emit('scene:request-state');
});
socket.on('connect_error', () => setStatus('reconectando…'));

text.addEventListener('input', () => {
  text.value = window.Nuvens.sanitizeText(text.value);
  counter.textContent = `${text.value.length}/80`;
});

createButton.addEventListener('click', () => {
  const payload = payloadFromControls();
  if (!payload.text) {
    setStatus('escreva uma frase');
    return;
  }
  socket.emit('cloud:create', payload, (response) => {
    if (!response?.ok) {
      setStatus(response?.error || 'não foi possível criar');
      return;
    }
    activeCloud = response.cloud;
    setStatus('nuvem criada');
  });
});

function updateCloud() {
  if (!activeCloud) return;
  socket.emit('cloud:update', payloadFromControls(), (response) => {
    if (response?.ok) activeCloud = response.cloud;
  });
}

Object.values(controls).forEach((control) => control.addEventListener('input', updateCloud));
