const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const connectionStatus = document.querySelector('#connectionStatus');

const SHEETS = {
  initialCrowd: { src: '/assets/characters/open-peeps-sheet.png', cols: 15, rows: 7 },
  participatory: { src: '/assets/characters/personas.png', cols: 15, rows: 7 },
};
const INITIAL_CROWD_SIZE = 70;
const PARTICIPANT_LIMIT = 80;
const EVAPORATION_TIME = 1000 * 60 * 2;
const PARTICIPANT_ZONE = { xMin: 0.08, xMax: 0.92, yMin: 0.52, yMax: 0.94 };

const sheets = new Map();
const initialCrowd = [];
const participantCharacters = new Map();
let dpr = 1;
let width = innerWidth;
let height = innerHeight;
let lastTime = performance.now();

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
function randomFrom(seed) {
  let state = seed >>> 0;
  return () => { state = Math.imul(state + 0x6d2b79f5, 1 | state); state ^= state + Math.imul(state ^ (state >>> 7), 61 | state); return ((state ^ (state >>> 14)) >>> 0) / 4294967296; };
}
function getCell(sheetKey, spriteIndex) {
  const sheet = sheets.get(sheetKey);
  if (!sheet?.image.complete || sheet.image.naturalWidth === 0) return null;
  const index = clamp(spriteIndex, 0, sheet.config.cols * sheet.config.rows - 1, 0);
  const cellWidth = sheet.image.naturalWidth / sheet.config.cols;
  const cellHeight = sheet.image.naturalHeight / sheet.config.rows;
  return {
    image: sheet.image,
    sx: (index % sheet.config.cols) * cellWidth,
    sy: Math.floor(index / sheet.config.cols) * cellHeight,
    sw: cellWidth,
    sh: cellHeight,
  };
}
function setConnectionError(message) {
  if (!connectionStatus) return;
  connectionStatus.textContent = message;
  connectionStatus.hidden = !message;
}
function loadSheets() {
  Object.entries(SHEETS).forEach(([key, config]) => {
    const image = new Image();
    image.src = config.src;
    sheets.set(key, { config, image });
  });
}
function resetInitialCrowd() {
  const rnd = randomFrom(hashString(`correria-${width}x${height}`));
  initialCrowd.length = 0;
  for (let i = 0; i < INITIAL_CROWD_SIZE; i += 1) {
    const direction = rnd() > 0.5 ? 1 : -1;
    const scale = lerp(0.32, 0.72, rnd());
    const depth = rnd();
    const y = lerp(height * 0.43, height * 0.98, depth);
    const speed = lerp(34, 112, rnd()) * lerp(0.72, 1.22, depth);
    initialCrowd.push({
      source: 'initialCrowd',
      spriteIndex: i % (SHEETS.initialCrowd.cols * SHEETS.initialCrowd.rows),
      x: rnd() * width,
      y,
      anchorY: y,
      direction,
      speed,
      scale,
      bob: rnd() * Math.PI * 2,
      opacity: lerp(0.72, 0.96, depth),
    });
  }
}
function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = innerWidth;
  height = innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resetInitialCrowd();
}
function normalizeParticipant(character) {
  const seed = character.seed || hashString(`${character.id}:${character.type}`);
  const y = clamp(character.y, PARTICIPANT_ZONE.yMin, PARTICIPANT_ZONE.yMax, 0.76);
  return {
    id: character.id,
    agentId: character.agentId || null,
    source: 'participatory',
    type: character.type || 'persona_01',
    spriteIndex: clamp(character.spriteIndex, 0, 104, 0),
    x: clamp(character.x, PARTICIPANT_ZONE.xMin, PARTICIPANT_ZONE.xMax, 0.5),
    y,
    targetX: clamp(character.targetX, PARTICIPANT_ZONE.xMin, PARTICIPANT_ZONE.xMax, character.x || 0.5),
    targetY: clamp(character.targetY, PARTICIPANT_ZONE.yMin, PARTICIPANT_ZONE.yMax, y),
    direction: character.direction === 'left' ? 'left' : 'right',
    speed: clamp(character.speed, 0, 0.55, 0.22),
    rhythm: clamp(character.rhythm, 0.12, 1.4, 0.7),
    scale: clamp(character.scale, 0.42, 0.9, 0.62),
    opacity: clamp(character.opacity, 0, 1, 0.94),
    zIndex: clamp(character.zIndex, 0, 1, y),
    createdAt: character.createdAt || Date.now(),
    life: clamp(character.life, 1000 * 60 * 4, 1000 * 60 * 20, 1000 * 60 * 8),
    phase: character.phase ?? randomFrom(seed)() * Math.PI * 2,
    dissolvingFrom: character.dissolvingFrom,
  };
}
function rebuildScene() {
  socket.emit('agent:join', {}, (response) => { if (!response?.ok) setConnectionError(response?.error || 'Conexão instável. Reconstruindo a cena…'); });
  socket.emit('scene:request-state');
}
socket.on('connect', () => { setConnectionError(''); rebuildScene(); });
socket.io.on('reconnect', () => { setConnectionError(''); rebuildScene(); });
socket.io.on('reconnect_attempt', () => setConnectionError('Reconectando à cena…'));
socket.io.on('reconnect_error', () => setConnectionError('Conexão instável. A cena será restaurada automaticamente.'));
socket.io.on('reconnect_failed', () => setConnectionError('Sem conexão com o servidor. Verifique a rede local.'));
socket.on('disconnect', () => setConnectionError('Reconectando à cena…'));
socket.on('connect_error', () => setConnectionError('Conexão instável. Tentando novamente…'));
socket.on('scene:state', (state) => { participantCharacters.clear(); (state.characters || []).forEach((character) => participantCharacters.set(character.id, normalizeParticipant(character))); });
socket.on('character:create', (character) => participantCharacters.set(character.id, normalizeParticipant(character)));
socket.on('character:update', (character) => participantCharacters.set(character.id, normalizeParticipant({ ...(participantCharacters.get(character.id) || {}), ...character })));
socket.on('character:remove', ({ id }) => { const character = participantCharacters.get(id); if (character) participantCharacters.set(id, { ...character, dissolvingFrom: Date.now() }); });
socket.on('scene:reset', () => participantCharacters.clear());

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#dfe8e5');
  gradient.addColorStop(0.58, '#eee5d2');
  gradient.addColorStop(1, '#8f8b67');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
function updateInitialCrowd(dt) {
  initialCrowd.forEach((peep) => {
    peep.x += peep.direction * peep.speed * dt;
    const cell = getCell('initialCrowd', peep.spriteIndex);
    const drawWidth = cell ? cell.sw * peep.scale : 240 * peep.scale;
    if (peep.direction > 0 && peep.x > width + drawWidth) peep.x = -drawWidth;
    if (peep.direction < 0 && peep.x < -drawWidth) peep.x = width + drawWidth;
  });
}
function updateParticipants(deltaMs) {
  const dt = deltaMs / 1000;
  const now = Date.now();
  participantCharacters.forEach((character, id) => {
    const dir = character.direction === 'left' ? -1 : 1;
    character.x += dir * character.speed * 0.035 * dt;
    character.x = clamp(lerp(character.x, character.targetX, 0.01), PARTICIPANT_ZONE.xMin, PARTICIPANT_ZONE.xMax, character.x);
    character.y = clamp(lerp(character.y, character.targetY, 0.02), PARTICIPANT_ZONE.yMin, PARTICIPANT_ZONE.yMax, character.y);
    if (character.x <= PARTICIPANT_ZONE.xMin + 0.002) character.direction = 'right';
    if (character.x >= PARTICIPANT_ZONE.xMax - 0.002) character.direction = 'left';
    character.phase += dt * character.rhythm * Math.PI;
    if (character.dissolvingFrom && now - character.dissolvingFrom > 9000) participantCharacters.delete(id);
    if (now - character.createdAt > character.life + EVAPORATION_TIME) participantCharacters.delete(id);
  });
}
function dissolveFactor(character, now) {
  const age = now - (character.createdAt || now);
  const ttlFade = age > character.life ? Math.max(0, 1 - (age - character.life) / EVAPORATION_TIME) : 1;
  const removalFade = character.dissolvingFrom ? Math.max(0, 1 - (now - character.dissolvingFrom) / 9000) : 1;
  return Math.min(ttlFade, removalFade);
}
function drawPeep(peep, nowMs) {
  const cell = getCell(peep.source, peep.spriteIndex);
  if (!cell) return;
  const y = peep.y + Math.sin(nowMs * 0.006 + peep.bob) * 5;
  const drawWidth = cell.sw * peep.scale;
  const drawHeight = cell.sh * peep.scale;
  ctx.save();
  ctx.globalAlpha = peep.opacity;
  ctx.translate(peep.x, y);
  ctx.scale(peep.direction < 0 ? -1 : 1, 1);
  ctx.drawImage(cell.image, cell.sx, cell.sy, cell.sw, cell.sh, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
  ctx.restore();
}
function drawParticipant(character, nowMs) {
  const cell = getCell('participatory', character.spriteIndex);
  if (!cell) return;
  const fade = dissolveFactor(character, Date.now());
  if (fade <= 0) return;
  const depthScale = lerp(0.78, 1.18, character.y);
  const drawWidth = cell.sw * character.scale * depthScale;
  const drawHeight = cell.sh * character.scale * depthScale;
  const x = character.x * width;
  const y = character.y * height + Math.sin(nowMs * 0.006 + character.phase) * character.rhythm * 4;
  ctx.save();
  ctx.globalAlpha = character.opacity * fade;
  ctx.fillStyle = 'rgba(28, 24, 20, 0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + 5, drawWidth * 0.32, drawHeight * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y);
  ctx.scale(character.direction === 'left' ? -1 : 1, 1);
  ctx.drawImage(cell.image, cell.sx, cell.sy, cell.sw, cell.sh, -drawWidth / 2, -drawHeight, drawWidth, drawHeight);
  ctx.restore();
}
function render(nowMs) {
  const deltaMs = Math.min(80, nowMs - lastTime);
  lastTime = nowMs;
  updateInitialCrowd(deltaMs / 1000);
  updateParticipants(deltaMs);
  drawBackground();
  const drawable = [
    ...initialCrowd.map((item) => ({ kind: 'initial', item, z: item.anchorY / height })),
    ...[...participantCharacters.values()].slice(-PARTICIPANT_LIMIT).map((item) => ({ kind: 'participant', item, z: item.zIndex ?? item.y })),
  ].sort((a, b) => a.z - b.z);
  drawable.forEach(({ kind, item }) => { if (kind === 'initial') drawPeep(item, nowMs); else drawParticipant(item, nowMs); });
  requestAnimationFrame(render);
}

loadSheets();
resizeCanvas();
window.addEventListener('resize', resizeCanvas);
requestAnimationFrame(render);
