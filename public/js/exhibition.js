const socket = window.Nuvens.createSocket();
const connectionStatus = document.querySelector('#connectionStatus');

const SHEETS = {
  initialCrowd: { src: '/assets/characters/open-peeps-sheet.png', rows: 7, cols: 15 },
  participatory: { src: '/assets/characters/personas.png', rows: 7, cols: 15 },
};
const PARTICIPANT_LIMIT = 80;
const EVAPORATION_TIME = 1000 * 60 * 2;
const VISUAL_QUALITY = {
  pixelDensityMax: 2,
  backgroundNoiseStep: 5,
  textureMarks: 1000,
  stainCount: 28,
  residueFadeAlpha: 10,
  baseResidueCount: 2,
  enableResidue: true,
  enableTextureOverlay: true,
  enableOrganicShadows: true,
};

const sheets = new Map();
const allPeeps = [];
const availableInitialPeeps = [];
const crowd = [];
const participantCharacters = new Map();
let sceneCanvas;
let backgroundLayer;
let textureLayer;
let residueLayer;
let shadowLayer;
let width = window.innerWidth;
let height = window.innerHeight;
let lastTime = 0;
let initialCrowdReady = false;

const randomRange = (min, max) => min + Math.random() * (max - min);
const randomIndex = (array) => randomRange(0, array.length) | 0;
const removeFromArray = (array, i) => array.splice(i, 1)[0];
const removeItemFromArray = (array, item) => {
  const index = array.indexOf(item);
  return index >= 0 ? removeFromArray(array, index) : null;
};
const removeRandomFromArray = (array) => removeFromArray(array, randomIndex(array));

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function easePower2In(value) { return value * value; }
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
function randomFrom(seed) {
  let state = seed >>> 0;
  return () => { state = Math.imul(state + 0x6d2b79f5, 1 | state); state ^= state + Math.imul(state ^ (state >>> 7), 61 | state); return ((state ^ (state >>> 14)) >>> 0) / 4294967296; };
}

class Peep {
  constructor({ id = null, source, image, rect, participant = false }) {
    this.id = id;
    this.source = source;
    this.image = image;
    this.rect = rect;
    this.width = rect[2];
    this.height = rect[3];
    this.participant = participant;
    this.x = 0;
    this.y = 0;
    this.anchorY = 0;
    this.scaleX = 1;
    this.progress = 0;
    this.timeScale = 1;
    this.opacity = 1;
    this.createdAt = Date.now();
    this.life = Infinity;
    this.dissolvingFrom = null;
  }
}

function preload() {
  Object.entries(SHEETS).forEach(([key, config]) => {
    const image = loadImage(config.src, () => {
      const sheet = sheets.get(key);
      if (sheet) sheet.loaded = true;
      if (key === 'initialCrowd') createInitialPeeps();
      if (key === 'participatory') participantCharacters.forEach((character) => ensureParticipantPeep(character));
    });
    sheets.set(key, { config, image, loaded: false });
  });
}

function setup() {
  width = windowWidth;
  height = windowHeight;
  pixelDensity(Math.min(window.devicePixelRatio || 1, VISUAL_QUALITY.pixelDensityMax));
  sceneCanvas = createCanvas(width, height);
  sceneCanvas.id('scene');
  sceneCanvas.attribute('aria-label', 'Paisagem generativa Nuvens Holandesas');
  buildVisualLayers();
  setupSocket();
  lastTime = millis();
}

function draw() {
  const nowMs = millis();
  const dt = Math.min(0.08, (nowMs - lastTime) / 1000);
  lastTime = nowMs;
  updateCrowd(dt);

  image(backgroundLayer, 0, 0);
  if (VISUAL_QUALITY.enableResidue) fadeResidueLayer();
  drawAllCharacterShadows();
  drawAllCharacters();
  drawAllPresenceResidue();
  if (VISUAL_QUALITY.enableResidue) {
    push();
    blendMode(MULTIPLY);
    image(residueLayer, 0, 0);
    blendMode(BLEND);
    pop();
  }
  drawSceneTextureOverlay();
}

function buildVisualLayers() {
  buildBackgroundLayer();
  buildTextureLayer();
  buildResidueLayer();
  shadowLayer = createGraphics(width, height);
}

function buildBackgroundLayer() {
  backgroundLayer = createGraphics(width, height);
  backgroundLayer.noStroke();
  const step = VISUAL_QUALITY.backgroundNoiseStep;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const n = noise(x * 0.002, y * 0.002);
      backgroundLayer.fill(229 + n * 13, 224 + n * 10, 204 + n * 8, 255);
      backgroundLayer.rect(x, y, step + 1, step + 1);
    }
  }
  drawOrganicStains(backgroundLayer);
}

function buildTextureLayer() {
  textureLayer = createGraphics(width, height);
  textureLayer.clear();
  drawPaperGrain(textureLayer);
  textureLayer.noFill();
  for (let i = 0; i < 120; i += 1) {
    textureLayer.stroke(44, 38, 28, random(4, 12));
    const x = random(width);
    const y = random(height);
    textureLayer.line(x, y, x + random(-10, 10), y + random(-2, 2));
  }
  for (let i = 0; i < 18; i += 1) {
    textureLayer.noStroke();
    textureLayer.fill(60, 48, 34, random(3, 9));
    textureLayer.ellipse(random(width), random(height), random(90, 260), random(35, 140));
  }
}

function buildResidueLayer() {
  residueLayer = createGraphics(width, height);
  residueLayer.clear();
}

function drawPaperGrain(layer) {
  layer.noStroke();
  for (let i = 0; i < VISUAL_QUALITY.textureMarks; i += 1) {
    layer.fill(40, 35, 25, random(4, 16));
    layer.circle(random(width), random(height), random(0.5, 1.8));
  }
}

function drawOrganicStains(layer) {
  const palette = [[155, 126, 70], [119, 128, 98], [105, 105, 96], [189, 166, 113]];
  layer.noStroke();
  for (let i = 0; i < VISUAL_QUALITY.stainCount; i += 1) {
    const [r, g, b] = random(palette);
    layer.fill(r, g, b, random(9, 24));
    layer.ellipse(random(width), random(height), random(120, 520), random(70, 290));
  }
}

function fadeResidueLayer() {
  residueLayer.noStroke();
  residueLayer.fill(232, 226, 207, VISUAL_QUALITY.residueFadeAlpha);
  residueLayer.rect(0, 0, width, height);
}

function drawPresenceResidue(character) {
  if (!VISUAL_QUALITY.enableResidue) return;
  const fade = dissolveFactor(character, Date.now());
  if (fade <= 0) return;
  const speed = Math.abs(character.endX - character.startX) * character.timeScale;
  const baseY = getCharacterRenderY(character);
  const depth = map(character.anchorY, 0, height, 0.55, 1.25, true);
  const direction = character.scaleX >= 0 ? -1 : 1;
  const count = character.participant ? VISUAL_QUALITY.baseResidueCount + 1 : VISUAL_QUALITY.baseResidueCount;
  residueLayer.noStroke();
  for (let i = 0; i < count; i += 1) {
    const alpha = (character.participant ? 18 : 11) * fade * depth;
    residueLayer.fill(69, 55, 36, alpha);
    residueLayer.ellipse(
      character.x + direction * random(3, 22) + random(-5, 5),
      baseY - random(0, character.height * 0.08),
      random(2, 7) * depth,
      random(0.8, 2.5) * depth,
    );
    residueLayer.stroke(78, 63, 42, alpha * 0.75);
    residueLayer.line(
      character.x + direction * random(4, 18),
      baseY - random(0, 8),
      character.x + direction * random(18, 34 + speed * 0.01),
      baseY + random(-2, 2),
    );
    residueLayer.noStroke();
  }
}

function drawOrganicCharacterShadow(character) {
  if (!VISUAL_QUALITY.enableOrganicShadows) return;
  const fade = dissolveFactor(character, Date.now());
  if (fade <= 0) return;
  const baseY = getCharacterRenderY(character);
  const depth = map(character.anchorY, 0, height, 0.65, 1.35, true);
  push();
  translate(character.x, baseY + character.height * 0.025);
  rotate(character.scaleX * 0.025);
  noStroke();
  blendMode(MULTIPLY);
  for (let i = 0; i < 3; i += 1) {
    fill(42, 35, 24, (character.participant ? 15 : 10) * fade);
    ellipse(random(-3, 3), random(-1, 2), character.width * (0.34 + i * 0.07) * depth, character.height * (0.028 + i * 0.011));
  }
  blendMode(BLEND);
  pop();
}

function drawSceneTextureOverlay() {
  if (!VISUAL_QUALITY.enableTextureOverlay) return;
  push();
  blendMode(MULTIPLY);
  tint(255, 76);
  image(textureLayer, 0, 0);
  noTint();
  blendMode(BLEND);
  pop();
}

function drawAllCharacterShadows() { crowd.forEach(drawOrganicCharacterShadow); }
function drawAllCharacters() { crowd.forEach((peep) => drawMovingCharacter(peep)); }
function drawAllPresenceResidue() { crowd.forEach(drawPresenceResidue); }

function getCharacterRenderY(character) {
  const bobProgress = (character.progress * 10 / 0.25) % 1;
  const bob = bobProgress < 0.5 ? bobProgress * 2 : (1 - bobProgress) * 2;
  // character.anchorY representa a base inferior do busto/personagem, não uma posição de apoio corporal.
  return character.anchorY - (10 * bob);
}

function drawMovingCharacter(character) {
  const fade = dissolveFactor(character, Date.now());
  if (fade <= 0) return;
  const baseY = getCharacterRenderY(character);
  push();
  tint(255, character.opacity * fade * 255);
  translate(character.x, baseY);
  scale(character.scaleX, 1);
  image(character.image, 0, -character.height, character.width, character.height, ...character.rect);
  noTint();
  pop();
}

function setConnectionError(message) {
  if (!connectionStatus) return;
  connectionStatus.textContent = message;
  connectionStatus.hidden = !message;
}

function getSpriteRect(source, spriteIndex) { return getSheetCell(source, spriteIndex); }
function getSheetCell(source, spriteIndex) {
  const sheet = sheets.get(source);
  if (!sheet?.image?.width) return null;
  const { rows, cols } = sheet.config;
  const index = clamp(spriteIndex, 0, rows * cols - 1, 0);
  const rectWidth = sheet.image.width / cols;
  const rectHeight = sheet.image.height / rows;
  return [
    (index % cols) * rectWidth,
    (index / cols | 0) * rectHeight,
    rectWidth,
    rectHeight,
  ];
}

function createBaseCrowd() { createInitialPeeps(); }
function createInitialPeeps() {
  const sheet = sheets.get('initialCrowd');
  if (!sheet?.image?.width) return;
  allPeeps.length = 0;
  const total = sheet.config.rows * sheet.config.cols;
  for (let i = 0; i < total; i += 1) {
    allPeeps.push(new Peep({ source: 'initialCrowd', image: sheet.image, rect: getSheetCell('initialCrowd', i) }));
  }
  initialCrowdReady = true;
  resetCrowd();
}

function createMovingCharacter(options) { return new Peep(options); }
function resetPeep(peep, { startProgress = 0 } = {}) {
  const direction = Math.random() > 0.5 ? 1 : -1;
  const offsetY = 100 - 250 * easePower2In(Math.random());
  const startY = height - peep.height + offsetY;
  let startX;
  let endX;
  if (direction === 1) { startX = -peep.width; endX = width; peep.scaleX = 1; }
  else { startX = width + peep.width; endX = 0; peep.scaleX = -1; }
  peep.startX = startX;
  peep.endX = endX;
  peep.x = startX;
  peep.y = startY;
  peep.anchorY = startY;
  peep.progress = startProgress;
  peep.timeScale = randomRange(0.5, 1.5);
  updateMovingCharacter(peep, 0);
  return peep;
}

function addPeepToCrowd(peep, options = {}) { resetPeep(peep, options); crowd.push(peep); sortCrowd(); return peep; }
function removePeepFromCrowd(peep) { removeItemFromArray(crowd, peep); if (!peep.participant) availableInitialPeeps.push(peep); }
function resetCrowd() {
  crowd.length = 0;
  availableInitialPeeps.length = 0;
  availableInitialPeeps.push(...allPeeps);
  while (availableInitialPeeps.length) addPeepToCrowd(removeRandomFromArray(availableInitialPeeps), { startProgress: Math.random() });
  participantCharacters.forEach((character) => { character.peep = null; ensureParticipantPeep(character); });
}

function normalizeParticipant(character) {
  const seed = character.seed || hashString(`${character.id}:${character.type}`);
  const rnd = randomFrom(seed);
  return {
    id: character.id,
    source: 'participatory',
    spriteIndex: clamp(character.spriteIndex, 0, 104, 0),
    opacity: clamp(character.opacity, 0, 1, 0.96),
    createdAt: character.createdAt || Date.now(),
    life: clamp(character.life, 1000 * 60 * 4, 1000 * 60 * 20, 1000 * 60 * 8),
    dissolvingFrom: character.dissolvingFrom,
    startProgress: clamp(character.x, 0, 1, rnd()),
    peep: null,
  };
}

function ensureParticipantPeep(character) {
  if (character.peep || crowd.some((peep) => peep.id === character.id)) return;
  const sheet = sheets.get('participatory');
  const rect = getSheetCell('participatory', character.spriteIndex);
  if (!sheet?.image || !rect) return;
  const peep = createMovingCharacter({ id: character.id, source: 'participatory', image: sheet.image, rect, participant: true });
  peep.opacity = character.opacity;
  peep.createdAt = character.createdAt;
  peep.life = character.life;
  peep.dissolvingFrom = character.dissolvingFrom;
  character.peep = peep;
  addPeepToCrowd(peep, { startProgress: character.startProgress });
}

function upsertParticipant(character) {
  const normalized = normalizeParticipant(character);
  const previous = participantCharacters.get(normalized.id);
  if (previous?.peep) {
    normalized.peep = previous.peep;
    normalized.peep.opacity = normalized.opacity;
    normalized.peep.life = normalized.life;
    normalized.peep.dissolvingFrom = normalized.dissolvingFrom;
  }
  participantCharacters.set(normalized.id, normalized);
  ensureParticipantPeep(normalized);
}

function setupSocket() {
  socket.on('connect', () => { setConnectionError(''); rebuildScene(); });
  socket.io.on('reconnect', () => { setConnectionError(''); rebuildScene(); });
  socket.io.on('reconnect_attempt', () => setConnectionError('Reconectando à cena…'));
  socket.io.on('reconnect_error', () => setConnectionError('Conexão instável. A cena será restaurada automaticamente.'));
  socket.io.on('reconnect_failed', () => setConnectionError('Sem conexão com o servidor. Verifique a rede local.'));
  socket.on('disconnect', () => setConnectionError('Reconectando à cena…'));
  socket.on('connect_error', () => setConnectionError('Conexão instável. Tentando novamente…'));
  socket.on('scene:state', (state) => {
    [...participantCharacters.values()].forEach((character) => { if (character.peep) removePeepFromCrowd(character.peep); });
    participantCharacters.clear();
    (state.characters || []).slice(-PARTICIPANT_LIMIT).forEach(upsertParticipant);
  });
  socket.on('character:create', upsertParticipant);
  socket.on('character:update', (character) => upsertParticipant({ ...(participantCharacters.get(character.id) || {}), ...character }));
  socket.on('character:remove', ({ id }) => {
    const character = participantCharacters.get(id);
    if (character?.peep) character.peep.dissolvingFrom = Date.now();
    if (character) character.dissolvingFrom = Date.now();
  });
  socket.on('scene:reset', () => {
    [...participantCharacters.values()].forEach((character) => { if (character.peep) removePeepFromCrowd(character.peep); });
    participantCharacters.clear();
  });
}

function rebuildScene() {
  socket.emit('agent:join', {}, (response) => { if (!response?.ok) setConnectionError(response?.error || 'Conexão instável. Reconstruindo a cena…'); });
  socket.emit('scene:request-state');
}

function updateMovingCharacter(peep, dt) { return updatePeepPosition(peep, dt); }
function updatePeepPosition(peep, dt) {
  peep.progress += (dt * peep.timeScale) / 10;
  if (peep.progress >= 1) {
    if (peep.participant) resetPeep(peep);
    else {
      removePeepFromCrowd(peep);
      addPeepToCrowd(removeRandomFromArray(availableInitialPeeps));
      return;
    }
  }
  peep.x = peep.startX + (peep.endX - peep.startX) * peep.progress;
}
function updateBaseCrowd(dt) { updateCrowd(dt); }
function updateCrowd(dt) {
  const now = Date.now();
  [...crowd].forEach((peep) => {
    updateMovingCharacter(peep, dt);
    if (peep.participant && dissolveFactor(peep, now) <= 0) {
      removePeepFromCrowd(peep);
      participantCharacters.delete(peep.id);
    }
  });
  sortCrowd();
}
function drawBaseCrowd() { drawAllCharacters(); }
function sortCrowd() { crowd.sort((a, b) => a.anchorY - b.anchorY); }
function dissolveFactor(character, now) {
  const age = now - (character.createdAt || now);
  const ttlFade = age > character.life ? Math.max(0, 1 - (age - character.life) / EVAPORATION_TIME) : 1;
  const removalFade = character.dissolvingFrom ? Math.max(0, 1 - (now - character.dissolvingFrom) / 9000) : 1;
  return Math.min(ttlFade, removalFade);
}

function recreateOrRepositionBaseCrowdIfNeeded() { if (initialCrowdReady) resetCrowd(); }
function windowResized() {
  width = windowWidth;
  height = windowHeight;
  resizeCanvas(width, height);
  buildVisualLayers();
  recreateOrRepositionBaseCrowdIfNeeded();
}
