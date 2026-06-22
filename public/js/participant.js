const socket = window.Nuvens.createSocket();
const statusEl = document.querySelector('#status');
const choiceLabel = document.querySelector('#choiceLabel');
const objectCards = document.querySelector('#objectCards');
const controlPanel = document.querySelector('#controlPanel');
const createButton = document.querySelector('#createObject');
const controls = ['x', 'y', 'speed', 'rhythm', 'fieldStrength', 'direction'].reduce((acc, id) => {
  acc[id] = document.querySelector(`#${id}`);
  return acc;
}, {});

const PERSONA_SHEET = { src: '/assets/characters/personas1.png', cols: 15, rows: 7 };
const PERSONA_COUNT = PERSONA_SHEET.cols * PERSONA_SHEET.rows;
const CHARACTER_PRESETS = [
  { type: 'persona_01', note: 'contribuição do público / deslocamento contínuo', speed: 0.3, rhythm: 0.8, field: 0.45, hue: 126 },
  { type: 'persona_02', note: 'contribuição do público / presença lenta', speed: 0.16, rhythm: 0.55, field: 0.68, hue: 194 },
  { type: 'persona_03', note: 'contribuição do público / travessia densa', speed: 0.24, rhythm: 0.65, field: 0.74, hue: 45 },
];
const CHARACTERS = createRandomCharacters();
const PARTICIPANT_ZONE = { xMin: 0.08, xMax: 0.92, yMin: 0.52, yMax: 0.94 };
let selectedType = null;
let activeCharacter = null;

function randomSpriteIndexes(count) {
  const indexes = Array.from({ length: PERSONA_COUNT }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[randomIndex]] = [indexes[randomIndex], indexes[index]];
  }
  return indexes.slice(0, count);
}
function createRandomCharacters() {
  const spriteIndexes = randomSpriteIndexes(CHARACTER_PRESETS.length);
  return CHARACTER_PRESETS.reduce((characters, preset, index) => {
    const spriteIndex = spriteIndexes[index];
    characters[preset.type] = {
      ...preset,
      label: `Persona ${String(spriteIndex + 1).padStart(3, '0')}`,
      spriteIndex,
    };
    return characters;
  }, {});
}

function setStatus(message) { statusEl.textContent = message; }
function selectedRules() { return CHARACTERS[selectedType] || CHARACTERS.persona_01; }
function spritePreviewStyle(spriteIndex) {
  const col = spriteIndex % PERSONA_SHEET.cols;
  const row = Math.floor(spriteIndex / PERSONA_SHEET.cols);
  return `--sprite-x:${col};--sprite-y:${row};background-image:url('${PERSONA_SHEET.src}')`;
}
function syncControlLimits() {
  const rules = selectedRules();
  controls.x.min = PARTICIPANT_ZONE.xMin; controls.x.max = PARTICIPANT_ZONE.xMax; controls.x.value = (PARTICIPANT_ZONE.xMin + PARTICIPANT_ZONE.xMax) / 2;
  controls.y.min = PARTICIPANT_ZONE.yMin; controls.y.max = PARTICIPANT_ZONE.yMax; controls.y.value = 0.78;
  controls.speed.value = rules.speed;
  controls.rhythm.value = rules.rhythm;
  controls.fieldStrength.value = rules.field;
  controls.direction.value = 'right';
}
function payloadFromControls() {
  const rules = selectedRules();
  const x = Number(controls.x.value);
  const y = Number(controls.y.value);
  return {
    type: selectedType,
    spriteKey: selectedType,
    spriteSource: 'personas',
    spriteIndex: rules.spriteIndex,
    x,
    y,
    targetX: x,
    targetY: y,
    direction: controls.direction.value,
    speed: Number(controls.speed.value),
    rhythm: Number(controls.rhythm.value),
    fieldStrength: Number(controls.fieldStrength.value),
    fieldRadius: 0.08 + Number(controls.fieldStrength.value) * 0.16,
    allowedZone: 'lower',
    scale: 0.62,
    opacity: 0.96,
    ambient: { hue: rules.hue },
  };
}
function selectCharacter(type) {
  selectedType = type;
  activeCharacter = null;
  [...objectCards.querySelectorAll('button')].forEach((button) => button.classList.toggle('is-selected', button.dataset.type === type));
  choiceLabel.textContent = CHARACTERS[type].label;
  createButton.textContent = 'Inserir na exposição';
  controlPanel.hidden = false;
  syncControlLimits();
}
function renderCards() {
  objectCards.innerHTML = Object.entries(CHARACTERS).map(([type, character]) => `
    <button class="object-card character-card" type="button" data-type="${type}">
      <span class="persona-preview" style="${spritePreviewStyle(character.spriteIndex)}" aria-hidden="true"></span>
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
    if (!response?.ok) { setStatus(response?.error || 'não foi possível inserir'); return; }
    activeCharacter = response.character;
    createButton.textContent = 'Atualizar personagem';
    setStatus('personagem na exposição');
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
