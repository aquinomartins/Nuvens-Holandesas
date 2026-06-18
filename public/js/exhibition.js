const mainCanvas = document.querySelector('#scene');
const ctx = mainCanvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const objects = new Map();
const characters = new Map();
const connectionStatus = document.querySelector('#connectionStatus');
const objectImages = new Map();
const characterImages = new Map();

const QUALITY = { maxObjects: 80, maxCharacters: 80, paperMarks: 160, particles: 240 };
const EVAPORATION_TIME = 1000 * 60 * 2;
const ZONES = {
  upper: { xMin: 0.05, xMax: 0.95, yMin: 0.05, yMax: 0.38 },
  middle: { xMin: 0.08, xMax: 0.92, yMin: 0.30, yMax: 0.65 },
  lower: { xMin: 0.08, xMax: 0.92, yMin: 0.58, yMax: 0.92 },
  lowerMiddle: { xMin: 0.08, xMax: 0.92, yMin: 0.46, yMax: 0.88 },
};
const OBJECTS = {
  green_bundle: { asset: '/assets/objects/green_bundle.png', zone: 'lower', base: 145 },
  red_cone: { asset: '/assets/objects/red_cone.png', zone: 'middle', base: 132 },
  yellow_blue_artifact: { asset: '/assets/objects/yellow_blue_artifact.png', zone: 'upper', base: 126 },
};
const CHARACTERS = {
  walker: { asset: '/assets/characters/walker.png', zone: 'lower', base: 118, hue: 128, frameCount: 6, frameRate: 9 },
  watcher: { asset: '/assets/characters/watcher.png', zone: 'middle', base: 126, hue: 198, frameCount: 4, frameRate: 5 },
  carrier: { asset: '/assets/characters/carrier.png', zone: 'lowerMiddle', base: 122, hue: 45, frameCount: 6, frameRate: 7 },
};
let backgroundCanvas = document.createElement('canvas');
let backgroundCtx = backgroundCanvas.getContext('2d');
let particles = [];
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
function zoneFor(name) { return ZONES[name] || ZONES.middle; }
function normalizeObject(object) {
  const config = OBJECTS[object.type] || OBJECTS.green_bundle;
  const zone = ZONES[object.zone] || ZONES[config.zone];
  const seed = object.seed || hashString(`${object.id}:${object.type}`);
  return { id: object.id, agentId: object.agentId || null, type: OBJECTS[object.type] ? object.type : 'green_bundle', zone: config.zone, x: clamp(object.x, zone.xMin, zone.xMax, (zone.xMin + zone.xMax) / 2), y: clamp(object.y, zone.yMin, zone.yMax, (zone.yMin + zone.yMax) / 2), scale: clamp(object.scale, 0.34, 1.28, 0.78), rotation: clamp(object.rotation, -24, 24, 0), opacity: clamp(object.opacity, 0, 1, 0.82), seed, createdAt: object.createdAt || Date.now(), updatedAt: object.updatedAt || Date.now(), life: clamp(object.life, 1000 * 60 * 4, 1000 * 60 * 24, 1000 * 60 * 9), phase: object.phase ?? randomFrom(seed)() * Math.PI * 2, dissolvingFrom: object.dissolvingFrom };
}
function normalizeCharacter(character) {
  const config = CHARACTERS[character.type] || CHARACTERS.walker;
  const zone = zoneFor(character.allowedZone || config.zone);
  const seed = character.seed || hashString(`${character.id}:${character.type}`);
  const x = clamp(character.x, zone.xMin, zone.xMax, (zone.xMin + zone.xMax) / 2);
  const y = clamp(character.y, zone.yMin, zone.yMax, (zone.yMin + zone.yMax) / 2);
  return {
    id: character.id, agentId: character.agentId || null, type: CHARACTERS[character.type] ? character.type : 'walker', spriteKey: character.spriteKey || character.type || 'walker',
    x, y, targetX: clamp(character.targetX, zone.xMin, zone.xMax, x), targetY: clamp(character.targetY, zone.yMin, zone.yMax, y), vx: clamp(character.vx, -0.02, 0.02, 0), vy: clamp(character.vy, -0.02, 0.02, 0),
    scale: clamp(character.scale, 0.7, 1.3, 0.96), rotation: clamp(character.rotation, -10, 10, 0), direction: character.direction === 'left' ? 'left' : 'right', speed: clamp(character.speed, 0, 0.55, 0.2), rhythm: clamp(character.rhythm, 0.12, 1.4, 0.7), fieldStrength: clamp(character.fieldStrength, 0.18, 1, 0.55), fieldRadius: clamp(character.fieldRadius, 0.07, 0.28, 0.15), mode: character.mode === 'rest' ? 'rest' : 'move', allowedZone: character.allowedZone || config.zone, zIndex: clamp(character.zIndex, 0, 1, y), opacity: clamp(character.opacity, 0, 1, 0.9), frameIndex: clamp(character.frameIndex, 0, 12, 0), frameCount: clamp(character.frameCount, 1, 12, config.frameCount), frameRate: clamp(character.frameRate, 1, 16, config.frameRate), createdAt: character.createdAt || Date.now(), updatedAt: character.updatedAt || Date.now(), life: clamp(character.life, 1000 * 60 * 4, 1000 * 60 * 20, 1000 * 60 * 8), ambient: character.ambient || { hue: config.hue }, seed, phase: character.phase ?? randomFrom(seed)() * Math.PI * 2, dissolvingFrom: character.dissolvingFrom,
  };
}
function loadImages() {
  Object.entries(OBJECTS).forEach(([type, config]) => { const image = new Image(); image.src = config.asset; objectImages.set(type, image); });
  Object.entries(CHARACTERS).forEach(([type, config]) => { const image = new Image(); image.src = config.asset; characterImages.set(type, image); });
}
function resetParticles() {
  const rnd = randomFrom(hashString(`particles-${width}x${height}`));
  particles = Array.from({ length: QUALITY.particles }, () => ({ x: rnd() * width, y: rnd() * height, px: 0, py: 0, vx: (rnd() - 0.5) * 0.25, vy: (rnd() - 0.5) * 0.25, hue: 160 + rnd() * 70, age: rnd() * 1000 }));
  particles.forEach((p) => { p.px = p.x; p.py = p.y; });
}
function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2); width = innerWidth; height = innerHeight;
  mainCanvas.width = Math.floor(width * dpr); mainCanvas.height = Math.floor(height * dpr); mainCanvas.style.width = `${width}px`; mainCanvas.style.height = `${height}px`; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  backgroundCanvas.width = Math.floor(width * dpr); backgroundCanvas.height = Math.floor(height * dpr); backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  backgroundSeed = hashString(`symbolic-field-${width}x${height}`); buildStaticBackground(); resetParticles();
}
window.addEventListener('resize', resizeCanvas);
function buildStaticBackground() {
  backgroundCtx.clearRect(0, 0, width, height);
  const gradient = backgroundCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#dfe8e5'); gradient.addColorStop(0.52, '#eee5d2'); gradient.addColorStop(1, '#8f8b67');
  backgroundCtx.fillStyle = gradient; backgroundCtx.fillRect(0, 0, width, height);
  const rnd = randomFrom(backgroundSeed); backgroundCtx.save(); backgroundCtx.strokeStyle = 'rgba(36, 34, 28, 0.075)'; backgroundCtx.lineWidth = 1;
  for (let i = 0; i < QUALITY.paperMarks; i += 1) { const y = rnd() * height; backgroundCtx.beginPath(); backgroundCtx.moveTo(rnd() * width * 0.2, y); backgroundCtx.lineTo(width * (0.65 + rnd() * 0.35), y + (rnd() - 0.5) * 16); backgroundCtx.stroke(); }
  Object.entries(ZONES).filter(([name]) => name !== 'lowerMiddle').forEach(([, zone], i) => { backgroundCtx.strokeStyle = `rgba(35, 34, 28, ${0.055 + i * 0.012})`; backgroundCtx.strokeRect(zone.xMin * width, zone.yMin * height, (zone.xMax - zone.xMin) * width, (zone.yMax - zone.yMin) * height); });
  backgroundCtx.restore();
}
function setConnectionError(message) { if (!connectionStatus) return; connectionStatus.textContent = message; connectionStatus.hidden = !message; }
function rebuildScene() { socket.emit('agent:join', {}, (response) => { if (!response?.ok) setConnectionError(response?.error || 'Conexão instável. Reconstruindo a cena…'); }); socket.emit('scene:request-state'); }
socket.on('connect', () => { setConnectionError(''); rebuildScene(); });
socket.io.on('reconnect', () => { setConnectionError(''); rebuildScene(); });
socket.io.on('reconnect_attempt', () => setConnectionError('Reconectando à cena…'));
socket.io.on('reconnect_error', () => setConnectionError('Conexão instável. A cena será restaurada automaticamente.'));
socket.io.on('reconnect_failed', () => setConnectionError('Sem conexão com o servidor. Verifique a rede local.'));
socket.on('disconnect', () => setConnectionError('Reconectando à cena…'));
socket.on('connect_error', () => setConnectionError('Conexão instável. Tentando novamente…'));
socket.on('scene:state', (state) => { objects.clear(); characters.clear(); (state.objects || []).forEach((object) => objects.set(object.id, normalizeObject(object))); (state.characters || []).forEach((character) => characters.set(character.id, normalizeCharacter(character))); });
socket.on('object:create', (object) => objects.set(object.id, normalizeObject(object)));
socket.on('object:update', (object) => objects.set(object.id, normalizeObject({ ...(objects.get(object.id) || {}), ...object })));
socket.on('object:remove', ({ id }) => { const object = objects.get(id); if (object) objects.set(id, { ...object, dissolvingFrom: Date.now() }); });
socket.on('character:create', (character) => characters.set(character.id, normalizeCharacter(character)));
socket.on('character:update', (character) => characters.set(character.id, normalizeCharacter({ ...(characters.get(character.id) || {}), ...character })));
socket.on('character:remove', ({ id }) => { const character = characters.get(id); if (character) characters.set(id, { ...character, dissolvingFrom: Date.now() }); });
socket.on('scene:reset', () => { objects.clear(); characters.clear(); });
function dissolveFactor(entity, now) { const age = now - (entity.createdAt || now); const ttlFade = age > entity.life ? Math.max(0, 1 - (age - entity.life) / EVAPORATION_TIME) : 1; const removalFade = entity.dissolvingFrom ? Math.max(0, 1 - (now - entity.dissolvingFrom) / 9000) : 1; if (entity.dissolvingFrom && removalFade <= 0) { objects.delete(entity.id); characters.delete(entity.id); } return Math.min(ttlFade, removalFade); }
function updateCharacters(deltaTime) {
  const dt = deltaTime / 1000;
  characters.forEach((character, id) => {
    const zone = zoneFor(character.allowedZone); const dir = character.direction === 'left' ? -1 : 1; const drift = character.mode === 'rest' ? 0 : dir * character.speed * 0.025 * dt;
    character.x += drift; character.x = clamp(lerp(character.x, character.targetX, 0.018), zone.xMin, zone.xMax, character.x); character.y = clamp(lerp(character.y, character.targetY, 0.025), zone.yMin, zone.yMax, character.y);
    if (character.x <= zone.xMin + 0.002) character.direction = 'right'; if (character.x >= zone.xMax - 0.002) character.direction = 'left';
    character.phase += dt * character.rhythm * Math.PI; character.frameIndex = (character.frameIndex + dt * character.frameRate * (character.mode === 'rest' ? 0.25 : 1)) % character.frameCount;
    const now = Date.now(); if (character.dissolvingFrom && now - character.dissolvingFrom > 9000) characters.delete(id); if (now - character.createdAt > character.life + EVAPORATION_TIME) characters.delete(id);
  });
}
function updateParticles(deltaTime) {
  const active = [...characters.values()]; const dt = Math.min(2.4, deltaTime / 16.67);
  particles.forEach((p) => {
    p.px = p.x; p.py = p.y; p.age += deltaTime;
    let ax = Math.sin((p.y + p.age * 0.012) * 0.008) * 0.006; let ay = Math.cos((p.x - p.age * 0.01) * 0.007) * 0.004;
    active.forEach((c) => {
      const cx = c.x * width; const cy = c.y * height; const dx = cx - p.x; const dy = cy - p.y; const dist = Math.hypot(dx, dy) || 1; const radius = c.fieldRadius * Math.min(width, height) * 1.9;
      if (dist < radius) { const force = (1 - dist / radius) * c.fieldStrength * 0.035; const spin = c.type === 'watcher' ? 1 : 0.35; const attract = c.type === 'carrier' ? 1 : -0.18; ax += (dx / dist) * force * attract + (-dy / dist) * force * spin; ay += (dy / dist) * force * attract + (dx / dist) * force * spin; p.hue = lerp(p.hue, c.ambient?.hue || CHARACTERS[c.type].hue, 0.02); }
    });
    p.vx = (p.vx + ax * dt) * 0.985; p.vy = (p.vy + ay * dt) * 0.985; p.x += p.vx * dt * 9; p.y += p.vy * dt * 9;
    if (p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) { p.x = (p.x + width) % width; p.y = (p.y + height) % height; p.px = p.x; p.py = p.y; }
  });
}
function drawParticles(targetCtx) {
  targetCtx.save(); targetCtx.globalCompositeOperation = 'multiply'; targetCtx.lineWidth = 0.75;
  particles.forEach((p) => { targetCtx.strokeStyle = `hsla(${p.hue}, 34%, 42%, 0.16)`; targetCtx.beginPath(); targetCtx.moveTo(p.px, p.py); targetCtx.lineTo(p.x, p.y); targetCtx.stroke(); });
  targetCtx.restore();
}
function drawObject(targetCtx, object, nowMs) {
  const image = objectImages.get(object.type); if (!image || !image.complete) return; const fade = dissolveFactor(object, Date.now()); if (fade <= 0) return;
  const config = OBJECTS[object.type]; const zone = ZONES[config.zone]; const zoneDepth = (object.y - zone.yMin) / Math.max(0.001, zone.yMax - zone.yMin); const size = config.base * object.scale * lerp(0.88, 1.18, zoneDepth) * Math.min(width, height) / 760; const x = object.x * width; const y = object.y * height + Math.sin(nowMs * 0.00055 + object.phase) * 3.5; const alpha = object.opacity * fade;
  targetCtx.save(); targetCtx.translate(x, y); targetCtx.globalAlpha = alpha; targetCtx.fillStyle = 'rgba(32, 28, 22, 0.18)'; targetCtx.beginPath(); targetCtx.ellipse(0, size * 0.45, size * 0.48, size * 0.12, 0, 0, Math.PI * 2); targetCtx.fill(); targetCtx.rotate((object.rotation * Math.PI) / 180); targetCtx.drawImage(image, -size / 2, -size / 2, size, size); targetCtx.restore();
}
function drawPlaceholder(targetCtx, character, size, frame) {
  const hue = character.ambient?.hue || CHARACTERS[character.type].hue; const step = Math.sin(frame * 1.7) * size * 0.08;
  targetCtx.fillStyle = `hsla(${hue}, 28%, 34%, 0.92)`; targetCtx.beginPath(); targetCtx.ellipse(0, -size * 0.22, size * 0.24, size * 0.32, 0, 0, Math.PI * 2); targetCtx.fill();
  targetCtx.fillStyle = `hsla(${hue + 18}, 34%, 48%, 0.88)`; targetCtx.beginPath(); targetCtx.ellipse(0, size * 0.05, size * 0.18, size * 0.3, 0, 0, Math.PI * 2); targetCtx.fill();
  targetCtx.strokeStyle = `hsla(${hue - 12}, 30%, 24%, 0.75)`; targetCtx.lineWidth = Math.max(2, size * 0.035); targetCtx.lineCap = 'round';
  targetCtx.beginPath(); targetCtx.moveTo(-size * 0.08, size * 0.28); targetCtx.lineTo(-size * 0.18, size * 0.48 + step); targetCtx.moveTo(size * 0.08, size * 0.28); targetCtx.lineTo(size * 0.2, size * 0.48 - step); targetCtx.stroke();
  if (character.type === 'carrier') { targetCtx.strokeStyle = 'rgba(96,72,28,0.55)'; targetCtx.strokeRect(size * 0.12, -size * 0.02, size * 0.28, size * 0.2); }
  if (character.type === 'watcher') { targetCtx.fillStyle = 'rgba(238,232,204,0.85)'; targetCtx.beginPath(); targetCtx.arc(0, -size * 0.26, size * 0.07, 0, Math.PI * 2); targetCtx.fill(); }
}
function drawCharacter(targetCtx, character, nowMs) {
  const fade = dissolveFactor(character, Date.now()); if (fade <= 0) return; const config = CHARACTERS[character.type]; const zone = zoneFor(character.allowedZone); const zoneDepth = (character.y - zone.yMin) / Math.max(0.001, zone.yMax - zone.yMin); const size = config.base * character.scale * lerp(0.88, 1.2, zoneDepth) * Math.min(width, height) / 760; const x = character.x * width; const y = character.y * height + Math.sin(nowMs * 0.0012 + character.phase) * character.rhythm * 2.4; const alpha = character.opacity * fade; const hue = character.ambient?.hue || config.hue;
  targetCtx.save(); targetCtx.translate(x, y); targetCtx.globalAlpha = alpha * 0.22; targetCtx.fillStyle = `hsla(${hue}, 48%, 42%, 0.5)`; targetCtx.beginPath(); targetCtx.arc(0, 0, character.fieldRadius * Math.min(width, height), 0, Math.PI * 2); targetCtx.fill(); targetCtx.globalAlpha = alpha; targetCtx.fillStyle = 'rgba(28, 24, 20, 0.18)'; targetCtx.beginPath(); targetCtx.ellipse(0, size * 0.52, size * 0.42, size * 0.11, 0, 0, Math.PI * 2); targetCtx.fill(); targetCtx.scale(character.direction === 'left' ? -1 : 1, 1); targetCtx.rotate((character.rotation * Math.PI) / 180);
  const image = characterImages.get(character.spriteKey) || characterImages.get(character.type); const frame = Math.floor(character.frameIndex) % character.frameCount;
  if (image && image.complete && image.naturalWidth > 0) { const sw = image.naturalWidth / character.frameCount; targetCtx.drawImage(image, frame * sw, 0, sw, image.naturalHeight, -size / 2, -size / 2, size, size); } else { drawPlaceholder(targetCtx, character, size, frame); }
  targetCtx.restore();
}
function updateObjects(deltaTime) { const now = Date.now(); objects.forEach((object, id) => { if (object.dissolvingFrom && now - object.dissolvingFrom > 9000) objects.delete(id); if (now - object.createdAt > object.life + EVAPORATION_TIME) objects.delete(id); object.phase += deltaTime * 0.00008; }); }
function render(nowMs) {
  const deltaTime = Math.min(80, nowMs - lastTime); lastTime = nowMs; updateObjects(deltaTime); updateCharacters(deltaTime); updateParticles(deltaTime);
  const activeObjects = [...objects.values()].slice(-QUALITY.maxObjects); const activeCharacters = [...characters.values()].slice(-QUALITY.maxCharacters); const drawable = [...activeObjects.map((item) => ({ kind: 'object', item })), ...activeCharacters.map((item) => ({ kind: 'character', item }))].sort((a, b) => (a.item.zIndex ?? a.item.y) - (b.item.zIndex ?? b.item.y));
  ctx.clearRect(0, 0, width, height); ctx.drawImage(backgroundCanvas, 0, 0, width, height); drawParticles(ctx); drawable.forEach(({ kind, item }) => { if (kind === 'character') drawCharacter(ctx, item, nowMs); else drawObject(ctx, item, nowMs); }); requestAnimationFrame(render);
}
loadImages(); resizeCanvas(); requestAnimationFrame(render);
