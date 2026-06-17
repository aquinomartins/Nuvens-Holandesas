const mainCanvas = document.querySelector('#scene');
const ctx = mainCanvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const clouds = new Map();
const connectionStatus = document.querySelector('#connectionStatus');

const QUALITY = {
  backgroundBrushStrokes: 280,
  cloudBrushMarks: 28,
  cloudShadowMarks: 8,
  maxClouds: 80,
  textureMarks: 220,
};
const CLOUD_TTL = 1000 * 60 * 8;
const EVAPORATION_TIME = 1000 * 60 * 2;
const ambientClouds = [];
let backgroundCanvas = document.createElement('canvas');
let backgroundCtx = backgroundCanvas.getContext('2d');
let backgroundImage = null;
let backgroundImagePromise = null;
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

// Converte frase em parâmetros formais: borda, ritmo, deriva, densidade e temperatura.
function textToAtmosphericSeed(text) {
  const clean = sanitizeText(text);
  const base = clean || 'silencio atmosferico';
  const textSeed = hashString(base);
  const letters = [...base.toLowerCase()].filter((char) => /[a-záàâãéêíóôõúüç]/i.test(char));
  const vowels = letters.filter((char) => 'aeiouáàâãéêíóôõúü'.includes(char)).length;
  const vowelRatio = letters.length ? vowels / letters.length : 0.42;
  const lengthRatio = Math.min(1, clean.length / 80);
  const rnd = randomFrom(textSeed);
  return {
    text: clean,
    textSeed,
    seed: textSeed,
    density: clamp(0.26 + lengthRatio * 0.42 + rnd() * 0.22, 0.15, 1, 0.55),
    verticalGrowth: clamp(0.34 + rnd() * 0.5 + lengthRatio * 0.26, 0.2, 1.25, 0.64),
    softness: clamp(0.28 + vowelRatio * 0.36 + rnd() * 0.12, 0.2, 0.86, 0.55),
    luminosity: clamp(0.38 + rnd() * 0.48 + (1 - lengthRatio) * 0.08, 0.2, 1, 0.58),
    drift: clamp((rnd() - 0.5) * 0.16, -0.35, 0.35, 0.035),
    temperature: clamp((rnd() - 0.5) * 2, -1, 1, 0),
    shadowMass: clamp(0.2 + lengthRatio * 0.42 + rnd() * 0.24, 0.1, 1, 0.46),
    outlineStrength: clamp(0.32 + rnd() * 0.5 + (1 - vowelRatio) * 0.18, 0.18, 1, 0.55),
    brushRhythm: clamp(0.28 + rnd() * 0.55 + lengthRatio * 0.22, 0.15, 1, 0.55),
    curvature: clamp(0.24 + vowelRatio * 0.42 + rnd() * 0.34, 0.12, 1, 0.5),
    lobeCount: Math.round(clamp(4 + lengthRatio * 5 + rnd() * 4, 4, 13, 7)),
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
    luminosity: clamp(cloud.luminosity, 0.2, 1, atmosphere.luminosity),
    shadowMass: clamp(cloud.shadowMass, 0.1, 1, atmosphere.shadowMass),
    verticalGrowth: clamp(cloud.verticalGrowth, 0.2, 1.25, atmosphere.verticalGrowth),
    softness: clamp(cloud.softness, 0.2, 0.86, atmosphere.softness),
    temperature: clamp(cloud.temperature, -1, 1, atmosphere.temperature),
    outlineStrength: clamp(cloud.outlineStrength, 0.18, 1, atmosphere.outlineStrength),
    brushRhythm: clamp(cloud.brushRhythm, 0.15, 1, atmosphere.brushRhythm),
    curvature: clamp(cloud.curvature, 0.12, 1, atmosphere.curvature),
    lobeCount: Math.round(clamp(cloud.lobeCount, 4, 13, atmosphere.lobeCount)),
    opacity: clamp(cloud.opacity, 0.12, 0.92, 0.74),
    seed,
    createdAt: cloud.createdAt || Date.now(),
    updatedAt: cloud.updatedAt || Date.now(),
    life: clamp(cloud.life, 1000 * 60 * 4, 1000 * 60 * 24, atmosphere.life),
    ambient: Boolean(cloud.ambient),
    phase: cloud.phase ?? randomFrom(seed)() * Math.PI * 2,
    dissolvingFrom: cloud.dissolvingFrom,
  };
}

// Ajusta DPR e reconstrói somente o fundo estático quando a tela muda.
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
  textureSeed = hashString(`${width}x${height}`);
  backgroundSeed = hashString(`planalto-${width}x${height}`);
  buildStaticBackground();
}
window.addEventListener('resize', resizeCanvas);

// Tenta usar imagem autoral em /assets; se falhar, o fundo procedural permanece.
function loadBackgroundImage() {
  if (backgroundImagePromise) return backgroundImagePromise;
  const sources = ['/assets/background.jpg', '/assets/background.png'];
  backgroundImagePromise = new Promise((resolve) => {
    const trySource = (index) => {
      if (index >= sources.length) { resolve(null); return; }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => trySource(index + 1);
      image.src = `${sources[index]}?v=${Date.now()}`;
    };
    trySource(0);
  }).then((image) => {
    backgroundImage = image;
    if (image) buildStaticBackground();
    return image;
  });
  return backgroundImagePromise;
}

function drawImageCover(targetCtx, image, x, y, w, h) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (image.naturalWidth - sw) / 2;
  const sy = (image.naturalHeight - sh) / 2;
  targetCtx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

// Pré-renderiza a paisagem: imagem opcional ou composição procedural com textura fixa.
function buildStaticBackground() {
  if (!backgroundCtx || !width || !height) return;
  backgroundCtx.clearRect(0, 0, width, height);
  if (backgroundImage) {
    drawImageCover(backgroundCtx, backgroundImage, 0, 0, width, height);
    backgroundCtx.fillStyle = 'rgba(229, 216, 177, 0.12)';
    backgroundCtx.fillRect(0, 0, width, height);
  } else {
    drawProceduralPainterlyBackground(backgroundCtx, width, height);
  }
  drawStaticTexture(backgroundCtx, width, height);
}

function drawProceduralPainterlyBackground(bgCtx, W, H) {
  drawPainterlySky(bgCtx, W, H);
  drawPainterlyPlanalto(bgCtx, W, H);
}

function drawPainterlySky(bgCtx, W, H) {
  const horizon = H * 0.74;
  const gradient = bgCtx.createLinearGradient(0, 0, 0, horizon);
  gradient.addColorStop(0, '#95b7c9');
  gradient.addColorStop(0.45, '#c8d8d4');
  gradient.addColorStop(0.82, '#e2d8ba');
  gradient.addColorStop(1, '#cbbd93');
  bgCtx.fillStyle = gradient;
  bgCtx.fillRect(0, 0, W, H);

  const rnd = randomFrom(backgroundSeed + 12);
  for (let i = 0; i < QUALITY.backgroundBrushStrokes; i += 1) {
    const y = rnd() * horizon * 0.94;
    const x = rnd() * W;
    const length = W * (0.035 + rnd() * 0.12);
    const angle = (rnd() - 0.5) * 0.75 + Math.sin(y * 0.012) * 0.16;
    const palette = ['#f2e7bd', '#dfe5dc', '#8fb1c7', '#b8cbd0', '#d7c17c', '#6f95b3'];
    drawBrushStroke(bgCtx, x, y, length, angle, 3 + rnd() * 11, palette[Math.floor(rnd() * palette.length)], 0.08 + rnd() * 0.18);
  }

  for (let i = 0; i < 34; i += 1) {
    const y = H * (0.08 + rnd() * 0.5);
    const x = rnd() * W;
    drawCurvedBrushStroke(bgCtx, [
      [x, y],
      [x + W * (0.05 + rnd() * 0.08), y + (rnd() - 0.5) * H * 0.08],
      [x + W * (0.12 + rnd() * 0.16), y + (rnd() - 0.5) * H * 0.11],
    ], 5 + rnd() * 8, rnd() > 0.5 ? '#edf0dc' : '#789db8', 0.09 + rnd() * 0.1);
  }
}

function drawPainterlyPlanalto(bgCtx, W, H) {
  const horizon = H * 0.74;
  bgCtx.fillStyle = '#9d9365';
  bgCtx.fillRect(0, horizon, W, H - horizon);

  const ridges = [
    ['#7f7656', horizon - H * 0.025, 0.16],
    ['#a18a57', horizon + H * 0.02, 0.22],
    ['#636d46', horizon + H * 0.1, 0.32],
  ];
  ridges.forEach(([color, y, amp], idx) => {
    bgCtx.fillStyle = color;
    bgCtx.beginPath();
    bgCtx.moveTo(0, H);
    bgCtx.lineTo(0, y);
    for (let x = 0; x <= W; x += W / 7) {
      bgCtx.lineTo(x, y + Math.sin(idx + x * 0.007) * H * 0.015 * amp + (idx ? x / W * H * 0.02 : 0));
    }
    bgCtx.lineTo(W, H);
    bgCtx.closePath();
    bgCtx.fill();
  });

  const rnd = randomFrom(backgroundSeed + 88);
  for (let i = 0; i < 95; i += 1) {
    const y = lerp(horizon + 6, H, rnd());
    drawBrushStroke(bgCtx, rnd() * W, y, W * (0.025 + rnd() * 0.1), (rnd() - 0.62) * 0.34, 4 + rnd() * 12, rnd() > 0.45 ? '#c29a4b' : '#485c39', 0.12 + rnd() * 0.2);
  }

  bgCtx.strokeStyle = 'rgba(236, 213, 151, 0.4)';
  bgCtx.lineWidth = Math.max(2, W * 0.003);
  bgCtx.beginPath();
  bgCtx.moveTo(W * 0.52, horizon + 14);
  bgCtx.bezierCurveTo(W * 0.49, H * 0.84, W * 0.42, H * 0.91, W * 0.36, H);
  bgCtx.stroke();
}

function drawBrushStroke(targetCtx, x, y, length, angle, lineWidth, color, alpha = 1) {
  targetCtx.save();
  targetCtx.globalAlpha = alpha;
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = lineWidth;
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  targetCtx.beginPath();
  targetCtx.moveTo(x - dx * 0.5, y - dy * 0.5);
  targetCtx.quadraticCurveTo(x + Math.sin(angle) * lineWidth, y - Math.cos(angle) * lineWidth, x + dx * 0.5, y + dy * 0.5);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawCurvedBrushStroke(targetCtx, points, lineWidth, color, alpha = 1) {
  if (points.length < 2) return;
  targetCtx.save();
  targetCtx.globalAlpha = alpha;
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = lineWidth;
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
  targetCtx.beginPath();
  targetCtx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i][0] + points[i + 1][0]) / 2;
    const midY = (points[i][1] + points[i + 1][1]) / 2;
    targetCtx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
  }
  const last = points[points.length - 1];
  targetCtx.lineTo(last[0], last[1]);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawStaticTexture(targetCtx, W, H) {
  const rnd = randomFrom(textureSeed + 3);
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'overlay';
  for (let i = 0; i < QUALITY.textureMarks; i += 1) {
    drawBrushStroke(targetCtx, rnd() * W, rnd() * H, 8 + rnd() * 28, rnd() * Math.PI, 0.7 + rnd() * 1.8, rnd() > 0.5 ? '#fff7df' : '#332c23', 0.018 + rnd() * 0.035);
  }
  targetCtx.globalCompositeOperation = 'source-over';
  const vignette = targetCtx.createRadialGradient(W * 0.5, H * 0.45, W * 0.22, W * 0.5, H * 0.52, W * 0.78);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(47, 39, 31, 0.15)');
  targetCtx.fillStyle = vignette;
  targetCtx.fillRect(0, 0, W, H);
  targetCtx.restore();
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
  const radius = (112 + cloud.density * 82) * cloud.scale * lerp(1.25, 0.55, depth);
  const drift = now * 0.000012 * (cloud.drift || 0.02) * width;
  const sx = (((cloud.x * width + drift + radius) % (width + radius * 2)) - radius);
  const sy = (0.06 + cloud.y * 0.56) * height;
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
    const wave = 1 + Math.sin(t * Math.PI * 3 + cloud.curvature * 2) * 0.08;
    const topBias = Math.sin(angle) < 0 ? 1 + cloud.verticalGrowth * 0.22 : 0.72 + cloud.density * 0.18;
    const rx = (0.72 + rnd() * 0.32) * wave;
    const ry = (0.26 + rnd() * 0.2) * topBias;
    points.push([Math.cos(angle) * rx, Math.sin(angle) * ry]);
  }
  const path = new Path2D();
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cp1 = [current[0] + (next[1] - current[1]) * 0.18 * cloud.curvature, current[1] - (next[0] - current[0]) * 0.18 * cloud.curvature];
    const cp2 = [next[0] - (next[1] - current[1]) * 0.18 * cloud.curvature, next[1] + (next[0] - current[0]) * 0.18 * cloud.curvature];
    path.bezierCurveTo(cp1[0], cp1[1], cp2[0], cp2[1], next[0], next[1]);
  }
  path.closePath();
  return path;
}

function getCloudBaseColor(cloud, depth) {
  if (cloud.temperature > 0.35) return `rgba(244, 231, 197, ${lerp(0.94, 0.62, depth)})`;
  if (cloud.temperature < -0.35) return `rgba(210, 224, 228, ${lerp(0.93, 0.58, depth)})`;
  return `rgba(235, 234, 218, ${lerp(0.94, 0.6, depth)})`;
}

function drawCloudShape(targetCtx, cloud, path, depth) {
  targetCtx.fillStyle = getCloudBaseColor(cloud, depth);
  targetCtx.fill(path);
  targetCtx.save();
  targetCtx.clip(path);
  targetCtx.globalCompositeOperation = 'multiply';
  targetCtx.fillStyle = `rgba(95, 101, 114, ${0.08 + cloud.shadowMass * 0.16})`;
  targetCtx.beginPath();
  targetCtx.ellipse(0.12, 0.18, 0.82, 0.22 + cloud.verticalGrowth * 0.05, -0.03, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.globalCompositeOperation = 'screen';
  targetCtx.fillStyle = `rgba(255, 249, 222, ${0.16 + cloud.luminosity * 0.18})`;
  targetCtx.beginPath();
  targetCtx.ellipse(-0.18, -0.18, 0.58, 0.17, -0.12, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.restore();
}

function drawCloudOutline(targetCtx, cloud, path, depth) {
  targetCtx.save();
  targetCtx.strokeStyle = cloud.temperature < 0 ? '#617f9b' : '#8b7158';
  targetCtx.globalAlpha = cloud.outlineStrength * lerp(0.62, 0.28, depth);
  targetCtx.lineWidth = lerp(4.2, 2.2, depth);
  targetCtx.lineJoin = 'round';
  targetCtx.stroke(path);
  targetCtx.globalAlpha *= 0.45;
  targetCtx.lineWidth *= 0.42;
  targetCtx.strokeStyle = '#2f4868';
  targetCtx.translate(0.018, 0.018);
  targetCtx.stroke(path);
  targetCtx.restore();
}

function drawCloudBrushMarks(targetCtx, cloud, depth) {
  const rnd = randomFrom(cloud.seed + 703);
  const count = Math.round(lerp(9, QUALITY.cloudBrushMarks, cloud.brushRhythm) * lerp(1, 0.55, depth));
  for (let i = 0; i < count; i += 1) {
    const x = (rnd() - 0.5) * 1.25;
    const y = (rnd() - 0.5) * 0.48;
    const angle = (rnd() - 0.5) * 0.9 + cloud.curvature * 0.35;
    const color = rnd() > 0.5 ? '#fff5cf' : (cloud.temperature < 0 ? '#829bb0' : '#b99d72');
    drawBrushStroke(targetCtx, x, y, 0.16 + rnd() * 0.42, angle, 0.018 + rnd() * 0.035, color, (0.18 + rnd() * 0.28) * lerp(1, 0.55, depth));
  }
}

// Desenha sombra gráfica no campo sem blur caro ou gradiente 3D.
function drawCloudShadowGraphic(targetCtx, cloud, nowMs) {
  const fade = dissolveFactor(cloud, Date.now());
  if (fade <= 0) return;
  const geom = cloudGeometry(cloud, nowMs);
  const horizon = height * 0.74;
  const alpha = fade * (1 - geom.depth) * cloud.shadowMass * cloud.density * 0.16 * cloud.opacity;
  if (alpha <= 0.01) return;
  const y = horizon + (1 - geom.depth) * height * 0.16 + cloud.y * 16;
  const rnd = randomFrom(cloud.seed + 333);
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'multiply';
  targetCtx.fillStyle = `rgba(47, 58, 42, ${alpha})`;
  targetCtx.beginPath();
  targetCtx.ellipse(geom.sx, y, geom.radius * (1.2 + cloud.scale * 0.2), geom.radius * 0.16, -0.05, 0, Math.PI * 2);
  targetCtx.fill();
  for (let i = 0; i < QUALITY.cloudShadowMarks; i += 1) {
    drawBrushStroke(targetCtx, geom.sx + (rnd() - 0.5) * geom.radius * 1.8, y + (rnd() - 0.5) * geom.radius * 0.22, geom.radius * (0.22 + rnd() * 0.42), (rnd() - 0.5) * 0.2, 3 + rnd() * 8, '#303d2d', alpha * 0.55);
  }
  targetCtx.restore();
}

function drawGraphicCloud(targetCtx, cloud, nowMs) {
  const fade = dissolveFactor(cloud, Date.now());
  if (fade <= 0) return;
  const geom = cloudGeometry(cloud, nowMs);
  const alpha = cloud.opacity * fade * lerp(0.95, 0.45, geom.depth) * (cloud.ambient ? 0.68 : 1);
  const path = buildCloudPath(cloud);
  targetCtx.save();
  targetCtx.translate(geom.sx, geom.sy);
  targetCtx.scale(geom.radius, geom.radius);
  targetCtx.globalAlpha = alpha;
  drawCloudShape(targetCtx, cloud, path, geom.depth);
  targetCtx.save();
  targetCtx.clip(path);
  drawCloudBrushMarks(targetCtx, cloud, geom.depth);
  targetCtx.restore();
  drawCloudOutline(targetCtx, cloud, path, geom.depth);
  targetCtx.restore();
}

// Mantém a obra respirando sem visitantes; reduz ambiente quando há participação.
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
      density: 0.22 + rnd() * 0.24, drift: 0.006 + rnd() * 0.015, opacity: visitorCount ? 0.18 : 0.28 + rnd() * 0.18,
      luminosity: 0.48 + rnd() * 0.28, shadowMass: 0.14 + rnd() * 0.2, life: 1000 * 60 * 60, ambient: true, seed,
      createdAt: Date.now() - rnd() * 1000 * 60 * 10,
    }));
  }
  ambientClouds.splice(target);
  ambientClouds.forEach((cloud) => { cloud.opacity = lerp(cloud.opacity, visitorCount ? 0.18 : 0.34, 0.01); });
  return ambientClouds;
}

function updateClouds(deltaTime) {
  const now = Date.now();
  clouds.forEach((cloud, id) => {
    const age = now - cloud.createdAt;
    if (cloud.dissolvingFrom && now - cloud.dissolvingFrom > 9000) clouds.delete(id);
    if (age > (cloud.life || CLOUD_TTL) + EVAPORATION_TIME) clouds.delete(id);
    cloud.y = clamp(cloud.y + Math.sin(performance.now() * 0.00008 + cloud.phase) * deltaTime * 0.000002, 0.02, 0.88, cloud.y);
  });
}

function drawAtmosphericHaze() {
  const horizon = height * 0.74;
  const haze = ctx.createLinearGradient(0, horizon - height * 0.16, 0, horizon + height * 0.1);
  haze.addColorStop(0, 'rgba(238, 232, 214, 0)');
  haze.addColorStop(0.55, 'rgba(238, 232, 214, 0.18)');
  haze.addColorStop(1, 'rgba(238, 232, 214, 0.04)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - height * 0.16, width, height * 0.3);
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
  activeClouds.forEach((cloud) => drawCloudShadowGraphic(ctx, cloud, nowMs));
  activeClouds.forEach((cloud) => drawGraphicCloud(ctx, cloud, nowMs));
  drawAtmosphericHaze();
  requestAnimationFrame(render);
}

resizeCanvas();
loadBackgroundImage();
requestAnimationFrame(render);
