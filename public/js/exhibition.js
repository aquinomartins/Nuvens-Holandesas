const mainCanvas = document.querySelector('#scene');
const ctx = mainCanvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const clouds = new Map();
const connectionStatus = document.querySelector('#connectionStatus');

const QUALITY = {
  skyHatchBands: 120,
  skyObliqueBands: 42,
  cloudInteriorMarks: 9,
  cloudShadowHatches: 18,
  atmosphericMarks: 26,
  maxClouds: 80,
  paperMarks: 180,
};
const CLOUD_TTL = 1000 * 60 * 8;
const EVAPORATION_TIME = 1000 * 60 * 2;
const ambientClouds = [];
let backgroundCanvas = document.createElement('canvas');
let backgroundCtx = backgroundCanvas.getContext('2d');
let dpr = 1;
let width = innerWidth;
let height = innerHeight;
let lastTime = performance.now();
let textureSeed = 1492;
let backgroundSeed = 1888;

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sanitizeText(text) {
  return window.Nuvens.sanitizeText(text);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state + 0x6d2b79f5, 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

// Converte frase em assinatura gráfica determinística: lóbulos, hachura, peso e deriva.
function textToAtmosphericSeed(text) {
  const clean = sanitizeText(text);
  const base = clean || 'silencio atmosferico';
  const textSeed = hashString(base);
  const letters = [...base.toLowerCase()].filter((char) => /[a-záàâãéêíóôõúüç]/i.test(char));
  const vowels = letters.filter((char) => 'aeiouáàâãéêíóôõúü'.includes(char)).length;
  const vowelRatio = letters.length ? vowels / letters.length : 0.42;
  const lengthRatio = Math.min(1, clean.length / 90);
  const rnd = randomFrom(textSeed);
  return {
    text: clean,
    textSeed,
    seed: textSeed,
    density: clamp(0.24 + lengthRatio * 0.36 + rnd() * 0.22, 0.15, 1, 0.5),
    drift: clamp((rnd() - 0.5) * 0.18, -0.35, 0.35, 0.035),
    curvature: clamp(0.28 + vowelRatio * 0.42 + rnd() * 0.26, 0.12, 1, 0.55),
    lobeCount: Math.round(clamp(5 + lengthRatio * 6 + rnd() * 4, 5, 15, 8)),
    contourRoughness: clamp(0.18 + (1 - vowelRatio) * 0.34 + rnd() * 0.24, 0.08, 0.85, 0.38),
    hatchDensity: clamp(0.16 + lengthRatio * 0.5 + rnd() * 0.22, 0.08, 0.9, 0.42),
    hatchAngle: lerp(-0.42, 0.42, rnd()),
    shadowStrength: clamp(0.14 + lengthRatio * 0.38 + rnd() * 0.22, 0.08, 0.82, 0.38),
    lineWeight: clamp(0.72 + rnd() * 1.12 + (1 - vowelRatio) * 0.36, 0.55, 2.4, 1.1),
    life: Math.round(1000 * 60 * (4 + rnd() * 6)),
  };
}

function normalizeCloud(cloud) {
  const atmosphere = textToAtmosphericSeed(cloud.text || '');
  const seed = cloud.seed || cloud.textSeed || hashString(`${cloud.id}:${cloud.text || ''}`);
  return {
    id: cloud.id,
    agentId: cloud.agentId || null,
    text: sanitizeText(cloud.text || ''),
    textSeed: cloud.textSeed || atmosphere.textSeed,
    x: clamp(cloud.x, 0, 1, 0.5),
    y: clamp(cloud.y, 0, 1, 0.32),
    scale: clamp(cloud.scale, 0.35, 2.8, 1),
    distance: clamp(cloud.distance, 0, 1, 0.45),
    density: clamp(cloud.density, 0.15, 1, atmosphere.density),
    drift: clamp(cloud.drift, -0.35, 0.35, atmosphere.drift),
    opacity: clamp(cloud.opacity, 0.12, 0.95, 0.82),
    curvature: clamp(cloud.curvature, 0.12, 1, atmosphere.curvature),
    lobeCount: Math.round(clamp(cloud.lobeCount, 5, 15, atmosphere.lobeCount)),
    contourRoughness: clamp(cloud.contourRoughness, 0.08, 0.85, atmosphere.contourRoughness),
    hatchDensity: clamp(cloud.hatchDensity, 0.08, 0.9, atmosphere.hatchDensity),
    hatchAngle: clamp(cloud.hatchAngle, -0.65, 0.65, atmosphere.hatchAngle),
    shadowStrength: clamp(cloud.shadowStrength, 0.08, 0.82, atmosphere.shadowStrength),
    lineWeight: clamp(cloud.lineWeight, 0.55, 2.4, atmosphere.lineWeight),
    seed,
    createdAt: cloud.createdAt || Date.now(),
    updatedAt: cloud.updatedAt || Date.now(),
    life: clamp(cloud.life, 1000 * 60 * 4, 1000 * 60 * 24, atmosphere.life),
    ambient: Boolean(cloud.ambient),
    phase: cloud.phase ?? randomFrom(seed)() * Math.PI * 2,
    dissolvingFrom: cloud.dissolvingFrom,
  };
}

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = innerWidth;
  height = innerHeight;
  mainCanvas.width = Math.floor(width * dpr);
  mainCanvas.height = Math.floor(height * dpr);
  mainCanvas.style.width = `${width}px`;
  mainCanvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  backgroundCanvas.width = Math.floor(width * dpr);
  backgroundCanvas.height = Math.floor(height * dpr);
  backgroundCanvas.style.width = `${width}px`;
  backgroundCanvas.style.height = `${height}px`;
  backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  textureSeed = hashString(`paper-${width}x${height}`);
  backgroundSeed = hashString(`durer-hatch-${width}x${height}`);
  buildStaticBackground();
}
window.addEventListener('resize', resizeCanvas);

function buildStaticBackground() {
  if (!backgroundCtx || !width || !height) return;
  backgroundCtx.clearRect(0, 0, width, height);
  drawPaperTone(backgroundCtx, width, height);
  drawSkyHatching(backgroundCtx, width, height);
  drawMinimalGround(backgroundCtx, width, height);
}

function drawPaperTone(targetCtx, W, H) {
  targetCtx.fillStyle = '#f7f2e7';
  targetCtx.fillRect(0, 0, W, H);
  const rnd = randomFrom(textureSeed + 17);
  targetCtx.save();
  for (let i = 0; i < QUALITY.paperMarks; i += 1) {
    const alpha = 0.018 + rnd() * 0.035;
    const color = rnd() > 0.54 ? `rgba(58, 48, 37, ${alpha})` : `rgba(255, 252, 239, ${alpha * 1.4})`;
    drawHatchLine(targetCtx, rnd() * W, rnd() * H, rnd() * W, rnd() * H, {
      color, alpha: 1, lineWidth: 0.35 + rnd() * 0.45, wobble: 0.35 + rnd() * 0.9, segments: 1,
    });
  }
  targetCtx.restore();
}

function drawSkyHatching(targetCtx, W, H) {
  const rnd = randomFrom(backgroundSeed + 41);
  const horizon = H * 0.79;
  drawHatchingField(targetCtx, { x: W * 0.02, y: H * 0.035, w: W * 0.96, h: horizon * 0.78 }, {
    seed: backgroundSeed + 1, count: QUALITY.skyHatchBands, spacing: Math.max(7, H * 0.012), angle: 0,
    alpha: 0.12, lineWidth: 0.55, wobble: 1.7, color: '#2c2925', lengthJitter: 0.28,
  });
  drawHatchingField(targetCtx, { x: W * 0.04, y: H * 0.12, w: W * 0.9, h: horizon * 0.48 }, {
    seed: backgroundSeed + 2, count: QUALITY.skyObliqueBands, spacing: Math.max(12, H * 0.022), angle: -0.18,
    alpha: 0.065, lineWidth: 0.45, wobble: 2.2, color: '#3b332c', lengthJitter: 0.45,
  });
  for (let i = 0; i < 18; i += 1) {
    const y = H * (0.12 + rnd() * 0.55);
    drawHatchLine(targetCtx, W * (0.08 + rnd() * 0.18), y, W * (0.72 + rnd() * 0.2), y + Math.sin(i) * H * 0.018, {
      color: '#3a342d', alpha: 0.045 + rnd() * 0.035, lineWidth: 0.45 + rnd() * 0.55, wobble: 3.2, segments: 3,
    });
  }
}

function drawMinimalGround(targetCtx, W, H) {
  const horizon = H * 0.8;
  drawHatchLine(targetCtx, 0, horizon, W, horizon - H * 0.012, { color: '#282520', alpha: 0.24, lineWidth: 1.1, wobble: 1.2, segments: 4 });
  drawHatchingField(targetCtx, { x: 0, y: horizon + H * 0.02, w: W, h: H - horizon }, {
    seed: backgroundSeed + 9, count: 45, spacing: Math.max(8, H * 0.015), angle: -0.08,
    alpha: 0.07, lineWidth: 0.52, wobble: 1.8, color: '#302b24', lengthJitter: 0.55,
  });
}

function drawHatchLine(targetCtx, x1, y1, x2, y2, options = {}) {
  const lineWidth = options.lineWidth ?? 1;
  const alpha = options.alpha ?? 1;
  const wobble = options.wobble ?? 1.4;
  const color = options.color || '#27231f';
  const segments = options.segments || 2;
  const seed = hashString(`${Math.round(x1 * 10)},${Math.round(y1 * 10)},${Math.round(x2 * 10)},${Math.round(y2 * 10)},${wobble}`);
  const rnd = randomFrom(seed);
  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.globalAlpha *= alpha;
  targetCtx.lineWidth = lineWidth * (0.82 + rnd() * 0.36);
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.beginPath();
  targetCtx.moveTo(x1, y1);
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const x = lerp(x1, x2, t) + (rnd() - 0.5) * wobble;
    const y = lerp(y1, y2, t) + (rnd() - 0.5) * wobble;
    targetCtx.lineTo(x, y);
    if (rnd() > 0.82) targetCtx.moveTo(x + (rnd() - 0.5) * 2, y + (rnd() - 0.5) * 2);
  }
  targetCtx.lineTo(x2 + (rnd() - 0.5) * wobble * 0.35, y2 + (rnd() - 0.5) * wobble * 0.35);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawHatchingField(targetCtx, area, options = {}) {
  const rnd = randomFrom(options.seed || backgroundSeed);
  const count = options.count || Math.ceil(area.h / (options.spacing || 10));
  const spacing = options.spacing || Math.max(6, area.h / count);
  const angle = options.angle || 0;
  const lengthJitter = options.lengthJitter ?? 0.2;
  for (let i = 0; i < count; i += 1) {
    const y = area.y + i * spacing + (rnd() - 0.5) * spacing * 0.55;
    const inset = area.w * (rnd() * lengthJitter * 0.5);
    const len = area.w * (0.74 + rnd() * (0.24 + lengthJitter * 0.32));
    const x1 = area.x + inset;
    const x2 = Math.min(area.x + area.w, x1 + len);
    const slope = Math.tan(angle) * (x2 - x1);
    drawHatchLine(targetCtx, x1, y, x2, y + slope + (rnd() - 0.5) * spacing * 0.7, options);
  }
}

function setConnectionError(message) {
  if (!connectionStatus) return;
  connectionStatus.textContent = message;
  connectionStatus.hidden = !message;
}

function rebuildScene() {
  socket.emit('agent:join', {}, (response) => {
    if (!response?.ok) setConnectionError(response?.error || 'Conexão instável. Reconstruindo a cena…');
  });
  socket.emit('scene:request-state');
}

socket.on('connect', () => { setConnectionError(''); rebuildScene(); });
socket.io.on('reconnect', () => { setConnectionError(''); rebuildScene(); });
socket.io.on('reconnect_attempt', () => setConnectionError('Reconectando à cena…'));
socket.io.on('reconnect_error', () => setConnectionError('Conexão instável. A cena será restaurada automaticamente.'));
socket.io.on('reconnect_failed', () => setConnectionError('Sem conexão com o servidor. Verifique a rede local.'));
socket.on('disconnect', () => setConnectionError('Reconectando à cena…'));
socket.on('connect_error', () => setConnectionError('Conexão instável. Tentando novamente…'));
socket.on('scene:state', (state) => { clouds.clear(); (state.clouds || []).forEach((cloud) => clouds.set(cloud.id, normalizeCloud(cloud))); });
socket.on('cloud:create', (cloud) => clouds.set(cloud.id, normalizeCloud(cloud)));
socket.on('cloud:update', (cloud) => clouds.set(cloud.id, normalizeCloud({ ...(clouds.get(cloud.id) || {}), ...cloud })));
socket.on('cloud:remove', ({ id }) => { const cloud = clouds.get(id); if (cloud) clouds.set(id, { ...cloud, dissolvingFrom: Date.now() }); });
socket.on('scene:reset', () => clouds.clear());

function cloudGeometry(cloud, now = performance.now()) {
  const depth = clamp(cloud.distance, 0, 1);
  const radius = (92 + cloud.density * 96) * cloud.scale * lerp(1.22, 0.55, depth);
  const drift = now * 0.000012 * (cloud.drift || 0.02) * width;
  const sx = (((cloud.x * width + drift + radius) % (width + radius * 2)) - radius);
  const sy = (0.055 + cloud.y * 0.58) * height;
  return { sx, sy, radius, depth };
}

function dissolveFactor(cloud, nowMs) {
  const age = nowMs - (cloud.createdAt || nowMs);
  const ttlFade = age > cloud.life ? Math.max(0, 1 - (age - cloud.life) / EVAPORATION_TIME) : 1;
  const removalFade = cloud.dissolvingFrom ? Math.max(0, 1 - (nowMs - cloud.dissolvingFrom) / 9000) : 1;
  if (cloud.dissolvingFrom && removalFade <= 0) clouds.delete(cloud.id);
  return Math.min(ttlFade, removalFade);
}

function buildCloudPath(cloud) {
  const rnd = randomFrom(cloud.seed + 501);
  const lobes = cloud.lobeCount;
  const points = [];
  for (let i = 0; i < lobes; i += 1) {
    const t = i / lobes;
    const angle = Math.PI * 2 * t;
    const upperLift = Math.sin(angle) < 0 ? 1.05 + cloud.curvature * 0.24 : 0.52 + cloud.density * 0.2;
    const rough = (rnd() - 0.5) * cloud.contourRoughness;
    const rx = 0.66 + rnd() * 0.32 + rough * 0.14;
    const ry = (0.35 + rnd() * 0.22 + rough * 0.12) * upperLift;
    points.push([Math.cos(angle) * rx, Math.sin(angle) * ry + (Math.sin(angle) > 0 ? 0.1 : -0.03)]);
  }
  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const tension = 0.16 + cloud.curvature * 0.12;
    const cp1 = [current[0] + (next[1] - current[1]) * tension, current[1] - (next[0] - current[0]) * tension];
    const cp2 = [next[0] - (next[1] - current[1]) * tension, next[1] + (next[0] - current[0]) * tension];
    path.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], next[0], next[1]);
  }
  path.closePath();
  return path;
}

function drawCloudFill(targetCtx, cloud, path) {
  targetCtx.save();
  targetCtx.fillStyle = cloud.ambient ? 'rgba(250, 247, 238, 0.9)' : 'rgba(252, 250, 243, 0.98)';
  targetCtx.fill(path);
  targetCtx.restore();
}

function drawCloudOutline(targetCtx, cloud, path) {
  targetCtx.save();
  targetCtx.strokeStyle = '#24211e';
  targetCtx.lineJoin = 'round';
  targetCtx.lineCap = 'round';
  targetCtx.globalAlpha = cloud.ambient ? 0.42 : 0.72;
  targetCtx.lineWidth = (1.2 + cloud.lineWeight * 0.75) / 120;
  targetCtx.stroke(path);
  targetCtx.globalAlpha *= 0.38;
  targetCtx.translate(0.006, 0.004);
  targetCtx.lineWidth *= 0.55;
  targetCtx.stroke(path);
  targetCtx.restore();
}

function drawCloudInteriorMarks(targetCtx, cloud, path) {
  const rnd = randomFrom(cloud.seed + 703);
  targetCtx.save();
  targetCtx.clip(path);
  const count = Math.round(QUALITY.cloudInteriorMarks * lerp(0.55, 1.25, cloud.hatchDensity));
  for (let i = 0; i < count; i += 1) {
    const x = (rnd() - 0.5) * 1.25;
    const y = 0.02 + rnd() * 0.38;
    const len = 0.1 + rnd() * 0.28;
    const curve = (rnd() - 0.5) * 0.08;
    targetCtx.save();
    targetCtx.strokeStyle = '#302b25';
    targetCtx.globalAlpha = (0.1 + rnd() * 0.12) * (cloud.ambient ? 0.6 : 1);
    targetCtx.lineWidth = (0.55 + cloud.lineWeight * 0.28) / 120;
    targetCtx.lineCap = 'round';
    targetCtx.beginPath();
    targetCtx.moveTo(x - len * 0.5, y);
    targetCtx.quadraticCurveTo(x, y + curve, x + len * 0.5, y + (rnd() - 0.5) * 0.05);
    targetCtx.stroke();
    targetCtx.restore();
  }
  targetCtx.restore();
}

function drawCloudShadowHatching(targetCtx, cloud, path) {
  const rnd = randomFrom(cloud.seed + 811);
  targetCtx.save();
  targetCtx.clip(path);
  const count = Math.round(QUALITY.cloudShadowHatches * cloud.hatchDensity);
  for (let i = 0; i < count; i += 1) {
    const x = -0.56 + rnd() * 1.12;
    const y = 0.18 + rnd() * 0.34;
    const len = 0.12 + rnd() * 0.3;
    drawHatchLine(targetCtx, x, y, x + Math.cos(cloud.hatchAngle) * len, y + Math.sin(cloud.hatchAngle) * len, {
      color: '#29251f', alpha: (0.09 + rnd() * 0.12) * cloud.shadowStrength, lineWidth: (0.55 + cloud.lineWeight * 0.2) / 120, wobble: 0.015, segments: 2,
    });
  }
  targetCtx.restore();
}

function drawCloud(targetCtx, cloud, nowMs) {
  const fade = dissolveFactor(cloud, Date.now());
  if (fade <= 0) return;
  const geom = cloudGeometry(cloud, nowMs);
  const alpha = cloud.opacity * fade * lerp(0.96, 0.45, geom.depth) * (cloud.ambient ? 0.62 : 1);
  const path = buildCloudPath(cloud);
  targetCtx.save();
  targetCtx.translate(geom.sx, geom.sy);
  targetCtx.scale(geom.radius, geom.radius);
  targetCtx.globalAlpha = alpha;
  drawCloudFill(targetCtx, cloud, path);
  drawCloudInteriorMarks(targetCtx, cloud, path);
  drawCloudShadowHatching(targetCtx, cloud, path);
  drawCloudOutline(targetCtx, cloud, path);
  targetCtx.restore();
}

function createAmbientClouds() {
  const visitorCount = [...clouds.values()].filter((cloud) => !cloud.ambient).length;
  const target = visitorCount ? 3 : 5;
  while (ambientClouds.length < target) {
    const seed = hashString(`ambiente-${Date.now()}-${ambientClouds.length}`);
    const rnd = randomFrom(seed);
    ambientClouds.push(normalizeCloud({
      id: `ambient-${seed}`,
      text: ['vento baixo', 'céu antigo', 'luz seca', 'campo suspenso'][ambientClouds.length % 4],
      x: rnd(), y: 0.13 + rnd() * 0.34, scale: 0.62 + rnd() * 0.76, distance: 0.54 + rnd() * 0.36,
      density: 0.22 + rnd() * 0.24, drift: 0.006 + rnd() * 0.015, opacity: visitorCount ? 0.18 : 0.32 + rnd() * 0.18,
      life: 1000 * 60 * 60, ambient: true, seed, createdAt: Date.now() - rnd() * 1000 * 60 * 10,
    }));
  }
  ambientClouds.splice(target);
  ambientClouds.forEach((cloud) => { cloud.opacity = lerp(cloud.opacity, visitorCount ? 0.18 : 0.36, 0.01); });
  return ambientClouds;
}

function updateClouds(deltaTime) {
  const now = Date.now();
  clouds.forEach((cloud, id) => {
    const age = now - cloud.createdAt;
    if (cloud.dissolvingFrom && now - cloud.dissolvingFrom > 9000) clouds.delete(id);
    if (age > (cloud.life || CLOUD_TTL) + EVAPORATION_TIME) clouds.delete(id);
    cloud.x = (cloud.x + cloud.drift * deltaTime * 0.000002 + 1) % 1;
    cloud.y = clamp(cloud.y + Math.sin(performance.now() * 0.00008 + cloud.phase) * deltaTime * 0.000002, 0.02, 0.88, cloud.y);
  });
}

function drawAtmosphericHatching(targetCtx, activeClouds) {
  const rnd = randomFrom(backgroundSeed + Math.floor(performance.now() * 0.0002));
  targetCtx.save();
  activeClouds.slice(0, 8).forEach((cloud) => {
    if (rnd() < 0.35) return;
    const geom = cloudGeometry(cloud);
    const y = geom.sy + (rnd() - 0.5) * geom.radius * 0.6;
    drawHatchLine(targetCtx, geom.sx - geom.radius * (1.3 + rnd()), y, geom.sx - geom.radius * 0.55, y + (rnd() - 0.5) * 8, {
      color: '#2d2924', alpha: 0.025 + rnd() * 0.025, lineWidth: 0.45, wobble: 2.2, segments: 2,
    });
  });
  for (let i = 0; i < QUALITY.atmosphericMarks; i += 1) {
    const y = height * (0.08 + rnd() * 0.62);
    const x = rnd() * width;
    drawHatchLine(targetCtx, x, y, x + width * (0.025 + rnd() * 0.08), y + (rnd() - 0.5) * 5, {
      color: '#2d2924', alpha: 0.018, lineWidth: 0.38, wobble: 1.6, segments: 2,
    });
  }
  targetCtx.restore();
}

function render(nowMs) {
  const deltaTime = Math.min(80, nowMs - lastTime);
  lastTime = nowMs;
  updateClouds(deltaTime);
  const activeClouds = [...clouds.values(), ...createAmbientClouds()]
    .slice(-QUALITY.maxClouds)
    .sort((a, b) => b.distance - a.distance);

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(backgroundCanvas, 0, 0, width, height);
  drawAtmosphericHatching(ctx, activeClouds);
  activeClouds.forEach((cloud) => drawCloud(ctx, cloud, nowMs));
  requestAnimationFrame(render);
}

resizeCanvas();
requestAnimationFrame(render);
