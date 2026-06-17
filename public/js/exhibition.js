const mainCanvas = document.querySelector('#scene');
const ctx = mainCanvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const objects = new Map();
const connectionStatus = document.querySelector('#connectionStatus');
const objectImages = new Map();

const QUALITY = { maxObjects: 80, paperMarks: 160, zoneLines: 3 };
const EVAPORATION_TIME = 1000 * 60 * 2;
const ZONES = {
  upper: { xMin: 0.05, xMax: 0.95, yMin: 0.05, yMax: 0.38 },
  middle: { xMin: 0.08, xMax: 0.92, yMin: 0.30, yMax: 0.65 },
  lower: { xMin: 0.08, xMax: 0.92, yMin: 0.58, yMax: 0.92 },
};
const OBJECTS = {
  green_bundle: { asset: '/assets/objects/green_bundle.png', zone: 'lower', base: 145 },
  red_cone: { asset: '/assets/objects/red_cone.png', zone: 'middle', base: 132 },
  yellow_blue_artifact: { asset: '/assets/objects/yellow_blue_artifact.png', zone: 'upper', base: 126 },
};
let backgroundCanvas = document.createElement('canvas');
let backgroundCtx = backgroundCanvas.getContext('2d');
let dpr = 1;
let width = innerWidth;
let height = innerHeight;
let lastTime = performance.now();
let backgroundSeed = 1888;

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
function normalizeObject(object) {
  const config = OBJECTS[object.type] || OBJECTS.green_bundle;
  const zone = ZONES[object.zone] || ZONES[config.zone];
  const seed = object.seed || hashString(`${object.id}:${object.type}`);
  return {
    id: object.id,
    agentId: object.agentId || null,
    type: config === OBJECTS[object.type] ? object.type : 'green_bundle',
    zone: config.zone,
    x: clamp(object.x, zone.xMin, zone.xMax, (zone.xMin + zone.xMax) / 2),
    y: clamp(object.y, zone.yMin, zone.yMax, (zone.yMin + zone.yMax) / 2),
    scale: clamp(object.scale, 0.34, 1.28, 0.78),
    rotation: clamp(object.rotation, -24, 24, 0),
    opacity: clamp(object.opacity, 0, 1, 0.82),
    seed,
    createdAt: object.createdAt || Date.now(),
    updatedAt: object.updatedAt || Date.now(),
    life: clamp(object.life, 1000 * 60 * 4, 1000 * 60 * 24, 1000 * 60 * 9),
    phase: object.phase ?? randomFrom(seed)() * Math.PI * 2,
    dissolvingFrom: object.dissolvingFrom,
  };
}
function loadImages() {
  Object.entries(OBJECTS).forEach(([type, config]) => {
    const image = new Image();
    image.src = config.asset;
    objectImages.set(type, image);
  });
}
function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = innerWidth; height = innerHeight;
  mainCanvas.width = Math.floor(width * dpr); mainCanvas.height = Math.floor(height * dpr);
  mainCanvas.style.width = `${width}px`; mainCanvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  backgroundCanvas.width = Math.floor(width * dpr); backgroundCanvas.height = Math.floor(height * dpr);
  backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  backgroundSeed = hashString(`symbolic-field-${width}x${height}`);
  buildStaticBackground();
}
window.addEventListener('resize', resizeCanvas);
function buildStaticBackground() {
  backgroundCtx.clearRect(0, 0, width, height);
  const gradient = backgroundCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#dfe8e5'); gradient.addColorStop(0.52, '#eee5d2'); gradient.addColorStop(1, '#8f8b67');
  backgroundCtx.fillStyle = gradient; backgroundCtx.fillRect(0, 0, width, height);
  const rnd = randomFrom(backgroundSeed);
  backgroundCtx.save();
  backgroundCtx.strokeStyle = 'rgba(36, 34, 28, 0.075)'; backgroundCtx.lineWidth = 1;
  for (let i = 0; i < QUALITY.paperMarks; i += 1) {
    const y = rnd() * height; backgroundCtx.beginPath(); backgroundCtx.moveTo(rnd() * width * 0.2, y); backgroundCtx.lineTo(width * (0.65 + rnd() * 0.35), y + (rnd() - 0.5) * 16); backgroundCtx.stroke();
  }
  Object.values(ZONES).forEach((zone, i) => {
    backgroundCtx.strokeStyle = `rgba(35, 34, 28, ${0.06 + i * 0.015})`;
    backgroundCtx.strokeRect(zone.xMin * width, zone.yMin * height, (zone.xMax - zone.xMin) * width, (zone.yMax - zone.yMin) * height);
  });
  backgroundCtx.restore();
}
function setConnectionError(message) {
  if (!connectionStatus) return;
  connectionStatus.textContent = message;
  connectionStatus.hidden = !message;
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
socket.on('scene:state', (state) => { objects.clear(); (state.objects || []).forEach((object) => objects.set(object.id, normalizeObject(object))); });
socket.on('object:create', (object) => objects.set(object.id, normalizeObject(object)));
socket.on('object:update', (object) => objects.set(object.id, normalizeObject({ ...(objects.get(object.id) || {}), ...object })));
socket.on('object:remove', ({ id }) => { const object = objects.get(id); if (object) objects.set(id, { ...object, dissolvingFrom: Date.now() }); });
socket.on('scene:reset', () => objects.clear());
function dissolveFactor(object, now) {
  const age = now - (object.createdAt || now);
  const ttlFade = age > object.life ? Math.max(0, 1 - (age - object.life) / EVAPORATION_TIME) : 1;
  const removalFade = object.dissolvingFrom ? Math.max(0, 1 - (now - object.dissolvingFrom) / 9000) : 1;
  if (object.dissolvingFrom && removalFade <= 0) objects.delete(object.id);
  return Math.min(ttlFade, removalFade);
}
function drawObject(targetCtx, object, nowMs) {
  const image = objectImages.get(object.type);
  if (!image || !image.complete) return;
  const fade = dissolveFactor(object, Date.now());
  if (fade <= 0) return;
  const config = OBJECTS[object.type];
  const zone = ZONES[config.zone];
  const zoneDepth = (object.y - zone.yMin) / Math.max(0.001, zone.yMax - zone.yMin);
  const size = config.base * object.scale * lerp(0.88, 1.18, zoneDepth) * Math.min(width, height) / 760;
  const x = object.x * width;
  const y = object.y * height + Math.sin(nowMs * 0.00055 + object.phase) * 3.5;
  const alpha = object.opacity * fade;
  targetCtx.save();
  targetCtx.translate(x, y);
  targetCtx.globalAlpha = alpha;
  targetCtx.fillStyle = 'rgba(32, 28, 22, 0.18)';
  targetCtx.beginPath();
  targetCtx.ellipse(0, size * 0.45, size * 0.48, size * 0.12, 0, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.rotate((object.rotation * Math.PI) / 180);
  targetCtx.drawImage(image, -size / 2, -size / 2, size, size);
  targetCtx.restore();
}
function updateObjects(deltaTime) {
  const now = Date.now();
  objects.forEach((object, id) => {
    if (object.dissolvingFrom && now - object.dissolvingFrom > 9000) objects.delete(id);
    if (now - object.createdAt > object.life + EVAPORATION_TIME) objects.delete(id);
    object.phase += deltaTime * 0.00008;
  });
}
function render(nowMs) {
  const deltaTime = Math.min(80, nowMs - lastTime); lastTime = nowMs;
  updateObjects(deltaTime);
  const activeObjects = [...objects.values()].slice(-QUALITY.maxObjects).sort((a, b) => a.y - b.y);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(backgroundCanvas, 0, 0, width, height);
  activeObjects.forEach((object) => drawObject(ctx, object, nowMs));
  requestAnimationFrame(render);
}
loadImages();
resizeCanvas();
requestAnimationFrame(render);
