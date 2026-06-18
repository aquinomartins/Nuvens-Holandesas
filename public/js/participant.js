const socket = window.Nuvens.createSocket();
const statusEl = document.querySelector('#status');
const choiceLabel = document.querySelector('#choiceLabel');
const objectCards = document.querySelector('#objectCards');
const controlPanel = document.querySelector('#controlPanel');
const createButton = document.querySelector('#createObject');
const controls = ['x', 'y', 'speed', 'rhythm', 'fieldStrength', 'direction', 'mode'].reduce((acc, id) => {
  acc[id] = document.querySelector(`#${id}`);
  return acc;
}, {});

const CHARACTERS = {
  walker: { label: 'Walker', note: 'deslocamento / rastro curto / zona inferior', zone: { xMin: 0.08, xMax: 0.92, yMin: 0.58, yMax: 0.92 }, rhythm: 0.8, speed: 0.32, field: 0.45 },
  watcher: { label: 'Watcher', note: 'presença / campo circular / zona média', zone: { xMin: 0.08, xMax: 0.92, yMin: 0.30, yMax: 0.65 }, rhythm: 0.4, speed: 0.08, field: 0.62 },
  carrier: { label: 'Carrier', note: 'mediação / atração / zona inferior-média', zone: { xMin: 0.08, xMax: 0.92, yMin: 0.46, yMax: 0.88 }, rhythm: 0.65, speed: 0.22, field: 0.72 },
};
let selectedType = null;
let activeCharacter = null;

function setStatus(message) { statusEl.textContent = message; }
function selectedRules() { return CHARACTERS[selectedType] || CHARACTERS.walker; }
function syncControlLimits() {
  const rules = selectedRules();
  controls.x.min = rules.zone.xMin; controls.x.max = rules.zone.xMax; controls.x.value = (rules.zone.xMin + rules.zone.xMax) / 2;
  controls.y.min = rules.zone.yMin; controls.y.max = rules.zone.yMax; controls.y.value = (rules.zone.yMin + rules.zone.yMax) / 2;
  controls.speed.value = rules.speed;
  controls.rhythm.value = rules.rhythm;
  controls.fieldStrength.value = rules.field;
  controls.direction.value = selectedType === 'watcher' ? 'right' : 'left';
  controls.mode.value = selectedType === 'watcher' ? 'rest' : 'move';
}
function payloadFromControls() {
  const x = Number(controls.x.value);
  const y = Number(controls.y.value);
  return {
    type: selectedType,
    spriteKey: selectedType,
    x,
    y,
    targetX: x,
    targetY: y,
    direction: controls.direction.value,
    speed: controls.speed.value,
    rhythm: controls.rhythm.value,
    fieldStrength: controls.fieldStrength.value,
    fieldRadius: 0.08 + Number(controls.fieldStrength.value) * 0.16,
    mode: controls.mode.value,
    allowedZone: selectedType === 'carrier' ? 'lowerMiddle' : (selectedType === 'watcher' ? 'middle' : 'lower'),
    scale: selectedType === 'watcher' ? 1.02 : 0.96,
    opacity: 0.92,
    ambient: { hue: selectedType === 'carrier' ? 45 : selectedType === 'watcher' ? 194 : 125 },
  };
}
function selectCharacter(type) {
  selectedType = type;
  activeCharacter = null;
  [...objectCards.querySelectorAll('button')].forEach((button) => button.classList.toggle('is-selected', button.dataset.type === type));
  choiceLabel.textContent = CHARACTERS[type].label;
  createButton.textContent = 'Ativar personagem';
  controlPanel.hidden = false;
  syncControlLimits();
}
function renderCards() {
  objectCards.innerHTML = Object.entries(CHARACTERS).map(([type, character]) => `
    <button class="object-card character-card" type="button" data-type="${type}">
      <span class="character-glyph character-glyph--${type}" aria-hidden="true"></span>
      <strong>${character.label}</strong>
      <span>${character.note}</span>
    </button>`).join('');
  objectCards.addEventListener('click', (event) => {
    const card = event.target.closest('.object-card');
    if (card) selectCharacter(card.dataset.type);
  });
}
function submitCharacter() {
  if (!selectedType) { setStatus('escolha um personagem'); return; }
  socket.emit(activeCharacter ? 'character:update' : 'character:create', payloadFromControls(), (response) => {
    if (!response?.ok) { setStatus(response?.error || 'não foi possível ativar'); return; }
    activeCharacter = response.character;
    createButton.textContent = 'Atualizar personagem';
    setStatus(activeCharacter ? 'personagem ativo' : 'personagem inserido');
  });
}

socket.on('connect', () => { setStatus('conectado'); socket.emit('agent:join'); });
socket.on('disconnect', () => setStatus('reconectando…'));
socket.io.on('reconnect', () => { socket.emit('agent:join'); socket.emit('scene:request-state'); });
socket.on('connect_error', () => setStatus('reconectando…'));
createButton.addEventListener('click', submitCharacter);
Object.values(controls).forEach((control) => control.addEventListener('input', () => {
  if (!activeCharacter) return;
  socket.emit('character:update', payloadFromControls(), (response) => { if (response?.ok) activeCharacter = response.character; });
}));
renderCards();
