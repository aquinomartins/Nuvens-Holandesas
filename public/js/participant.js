const socket = window.Nuvens.createSocket();
const statusEl = document.querySelector('#status');
const choiceLabel = document.querySelector('#choiceLabel');
const objectCards = document.querySelector('#objectCards');
const controlPanel = document.querySelector('#controlPanel');
const createButton = document.querySelector('#createObject');
const controls = ['x', 'y', 'scale', 'rotation', 'opacity'].reduce((acc, id) => {
  acc[id] = document.querySelector(`#${id}`);
  return acc;
}, {});

const OBJECTS = {
  green_bundle: { label: 'Feixe verde', asset: '/assets/objects/green_bundle.png', note: 'vegetal / matéria / amarração' },
  red_cone: { label: 'Cone vermelho', asset: '/assets/objects/red_cone.png', note: 'impulso / chama / ritual' },
  yellow_blue_artifact: { label: 'Artefato amarelo', asset: '/assets/objects/yellow_blue_artifact.png', note: 'mediação / objeto híbrido' },
};
const OBJECT_RULES = {
  green_bundle: { zone: { xMin: 0.08, xMax: 0.92, yMin: 0.58, yMax: 0.92 }, scaleMin: 0.42, scaleMax: 1.28, rotationMin: -18, rotationMax: 18, opacityMin: 0.45, opacityMax: 0.95 },
  red_cone: { zone: { xMin: 0.08, xMax: 0.92, yMin: 0.30, yMax: 0.65 }, scaleMin: 0.36, scaleMax: 1.08, rotationMin: -24, rotationMax: 24, opacityMin: 0.5, opacityMax: 0.96 },
  yellow_blue_artifact: { zone: { xMin: 0.05, xMax: 0.95, yMin: 0.05, yMax: 0.38 }, scaleMin: 0.34, scaleMax: 1, rotationMin: -14, rotationMax: 14, opacityMin: 0.48, opacityMax: 0.94 },
};
let selectedType = null;
let activeObject = null;

function setStatus(message) { statusEl.textContent = message; }
function selectedRules() { return OBJECT_RULES[selectedType] || OBJECT_RULES.green_bundle; }
function syncControlLimits() {
  const rules = selectedRules();
  controls.x.min = rules.zone.xMin; controls.x.max = rules.zone.xMax; controls.x.value = (rules.zone.xMin + rules.zone.xMax) / 2;
  controls.y.min = rules.zone.yMin; controls.y.max = rules.zone.yMax; controls.y.value = (rules.zone.yMin + rules.zone.yMax) / 2;
  controls.scale.min = rules.scaleMin; controls.scale.max = rules.scaleMax; controls.scale.value = Math.min(rules.scaleMax, Math.max(rules.scaleMin, 0.78));
  controls.rotation.min = rules.rotationMin; controls.rotation.max = rules.rotationMax; controls.rotation.value = 0;
  controls.opacity.min = rules.opacityMin; controls.opacity.max = rules.opacityMax; controls.opacity.value = 0.82;
}
function payloadFromControls() {
  return { type: selectedType, x: controls.x.value, y: controls.y.value, scale: controls.scale.value, rotation: controls.rotation.value, opacity: controls.opacity.value };
}
function selectObject(type) {
  selectedType = type;
  activeObject = null;
  [...objectCards.querySelectorAll('button')].forEach((button) => button.classList.toggle('is-selected', button.dataset.type === type));
  choiceLabel.textContent = OBJECTS[type].label;
  createButton.textContent = 'Inserir objeto';
  controlPanel.hidden = false;
  syncControlLimits();
}
function renderCards() {
  objectCards.innerHTML = Object.entries(OBJECTS).map(([type, object]) => `
    <button class="object-card" type="button" data-type="${type}">
      <img src="${object.asset}" alt="" />
      <strong>${object.label}</strong>
      <span>${object.note}</span>
    </button>`).join('');
  objectCards.addEventListener('click', (event) => {
    const card = event.target.closest('.object-card');
    if (card) selectObject(card.dataset.type);
  });
}

socket.on('connect', () => { setStatus('conectado'); socket.emit('agent:join'); });
socket.on('disconnect', () => setStatus('reconectando…'));
socket.io.on('reconnect', () => { socket.emit('agent:join'); socket.emit('scene:request-state'); });
socket.on('connect_error', () => setStatus('reconectando…'));

createButton.addEventListener('click', () => {
  if (!selectedType) { setStatus('escolha um objeto'); return; }
  socket.emit(activeObject ? 'object:update' : 'object:create', payloadFromControls(), (response) => {
    if (!response?.ok) { setStatus(response?.error || 'não foi possível inserir'); return; }
    activeObject = response.object;
    createButton.textContent = 'Atualizar objeto';
    setStatus(activeObject ? 'objeto ativo' : 'objeto inserido');
  });
});
Object.values(controls).forEach((control) => control.addEventListener('input', () => {
  if (!activeObject) return;
  socket.emit('object:update', payloadFromControls(), (response) => { if (response?.ok) activeObject = response.object; });
}));
renderCards();
