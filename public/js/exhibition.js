const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const clouds = new Map();
const connectionStatus = document.querySelector('#connectionStatus');

const QUALITY = { cloudMassCount: 60, textureGrainCount: 900, filamentCount: 24 };
const CLOUD_TTL = 1000 * 60 * 8;
const EVAPORATION_TIME = 1000 * 60 * 2;
const ambientClouds = [];
let dpr = 1;
let width = innerWidth;
let height = innerHeight;
let lastTime = performance.now();
let textureSeed = 1492;

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
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

// Converte a frase em clima: uma semente pictórica determinística, não uma legenda.
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
    density: clamp(0.28 + lengthRatio * 0.46 + rnd() * 0.2, 0.15, 1, 0.55),
    verticalGrowth: clamp(0.38 + rnd() * 0.5 + lengthRatio * 0.24, 0.2, 1.25, 0.64),
    softness: clamp(0.36 + vowelRatio * 0.44 + rnd() * 0.18, 0.25, 1, 0.66),
    luminosity: clamp(0.38 + rnd() * 0.48 + (1 - lengthRatio) * 0.08, 0.2, 1, 0.58),
    drift: clamp((rnd() - 0.5) * 0.16, -0.35, 0.35, 0.035),
    temperature: clamp((rnd() - 0.5) * 2, -1, 1, 0),
    shadowMass: clamp(0.22 + lengthRatio * 0.42 + rnd() * 0.26, 0.1, 1, 0.46),
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
    softness: clamp(cloud.softness, 0.25, 1, atmosphere.softness),
    temperature: clamp(cloud.temperature, -1, 1, atmosphere.temperature),
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

// Mantém o Canvas nítido em telas grandes e projeções, respeitando devicePixelRatio.
function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = innerWidth;
  height = innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  textureSeed = hashString(`${width}x${height}`);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

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

// Céu dominante com veladuras e luz seca, evitando fundo digital plano.
function drawSky() {
  const horizon = height * 0.76;
  const skyGradient = ctx.createLinearGradient(0, 0, 0, horizon + 80);
  skyGradient.addColorStop(0, '#cfdde1');
  skyGradient.addColorStop(0.36, '#d9e1df');
  skyGradient.addColorStop(0.68, '#e4ddcc');
  skyGradient.addColorStop(1, '#c9bea3');
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, width, height);

  const sun = ctx.createRadialGradient(width * 0.19, height * 0.2, 0, width * 0.19, height * 0.2, width * 0.9);
  sun.addColorStop(0, 'rgba(250, 240, 206, 0.32)');
  sun.addColorStop(0.42, 'rgba(238, 228, 203, 0.12)');
  sun.addColorStop(1, 'rgba(120, 137, 142, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 8; i += 1) {
    const y = height * (0.1 + i * 0.075);
    ctx.fillStyle = `rgba(255, 249, 230, ${0.018 + i * 0.002})`;
    ctx.fillRect(0, y, width, 1 + i * 0.5);
  }
}

// Horizonte baixo do Planalto Central: chapadas, ocres, cerrado e caminho discreto.
function drawPlanalto() {
  const horizon = height * 0.76;
  const land = ctx.createLinearGradient(0, horizon, 0, height);
  land.addColorStop(0, '#b4aa88');
  land.addColorStop(0.34, '#8f8d66');
  land.addColorStop(0.72, '#706d4c');
  land.addColorStop(1, '#4d553d');
  ctx.fillStyle = land;
  ctx.fillRect(0, horizon, width, height - horizon);

  ctx.fillStyle = 'rgba(111, 92, 61, 0.2)';
  [0.18, 0.48, 0.76].forEach((offset, idx) => {
    ctx.beginPath();
    ctx.moveTo(width * (offset - 0.25), horizon + 8 + idx * 8);
    ctx.lineTo(width * (offset - 0.06), horizon - 22 - idx * 2);
    ctx.lineTo(width * (offset + 0.16), horizon - 20 + idx * 3);
    ctx.lineTo(width * (offset + 0.3), horizon + 10 + idx * 5);
    ctx.closePath();
    ctx.fill();
  });

  ctx.strokeStyle = 'rgba(235, 220, 174, 0.16)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(width * 0.52, horizon + 14);
  ctx.bezierCurveTo(width * 0.49, height * 0.86, width * 0.42, height * 0.9, width * 0.37, height);
  ctx.stroke();
  drawDistantArchitecture();
  drawCerradoVegetation();
}

function drawDistantArchitecture() {
  const horizon = height * 0.76;
  ctx.save();
  ctx.fillStyle = 'rgba(245, 241, 225, 0.52)';
  ctx.strokeStyle = 'rgba(101, 88, 66, 0.22)';
  const x = width * 0.64;
  const y = horizon - 8;
  ctx.fillRect(x, y - 9, 12, 9);
  ctx.beginPath();
  ctx.moveTo(x - 1, y - 9); ctx.lineTo(x + 6, y - 16); ctx.lineTo(x + 13, y - 9); ctx.closePath(); ctx.fill();
  ctx.fillRect(x + 15, y - 18, 5, 18);
  ctx.restore();
}

function drawCerradoVegetation() {
  const horizon = height * 0.76;
  const rnd = randomFrom(8117);
  ctx.save();
  for (let i = 0; i < 90; i += 1) {
    const x = rnd() * width;
    const y = horizon + rnd() * (height - horizon);
    const s = (0.5 + rnd() * 1.8) * (0.4 + (y - horizon) / (height - horizon));
    ctx.strokeStyle = `rgba(46, 62, 39, ${0.08 + rnd() * 0.13})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 5 * s, y - 7 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function cloudGeometry(cloud, now = performance.now()) {
  const depth = 1 - cloud.distance;
  const radius = (110 + cloud.density * 90) * cloud.scale * (0.42 + depth * 1.08);
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

function drawCloudMass(options) {
  const { x, y, rx, ry, color, alpha, softness = 0.8 } = options;
  const g = ctx.createRadialGradient(x - rx * 0.16, y - ry * 0.2, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, color.replace('ALPHA', alpha.toFixed(3)));
  g.addColorStop(0.48, color.replace('ALPHA', (alpha * 0.42).toFixed(3)));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * (1 + softness * 0.18), ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloudInternalShadow(cloud, geom, alpha) {
  const rnd = randomFrom(cloud.seed + 41);
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 10 + cloud.density * 12; i += 1) {
    const x = geom.sx + (rnd() - 0.5) * geom.radius * 1.35;
    const y = geom.sy + geom.radius * (0.04 + rnd() * 0.27) * cloud.verticalGrowth;
    drawCloudMass({ x, y, rx: geom.radius * (0.18 + rnd() * 0.18), ry: geom.radius * (0.06 + rnd() * 0.08), color: 'rgba(86, 100, 104, ALPHA)', alpha: alpha * cloud.shadowMass * 0.24, softness: cloud.softness });
  }
  ctx.restore();
}

function drawCloudLight(cloud, geom, alpha) {
  const rnd = randomFrom(cloud.seed + 91);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 12; i += 1) {
    const x = geom.sx - geom.radius * 0.24 + (rnd() - 0.5) * geom.radius * 1.1;
    const y = geom.sy - geom.radius * (0.18 + rnd() * 0.22) * cloud.verticalGrowth;
    drawCloudMass({ x, y, rx: geom.radius * (0.12 + rnd() * 0.18), ry: geom.radius * (0.05 + rnd() * 0.1), color: 'rgba(255, 249, 224, ALPHA)', alpha: alpha * cloud.luminosity * 0.42, softness: cloud.softness });
  }
  ctx.restore();
}

function drawCloudFilaments(cloud, geom, alpha, now) {
  const rnd = randomFrom(cloud.seed + 131);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  for (let i = 0; i < QUALITY.filamentCount; i += 1) {
    const angle = rnd() * Math.PI * 2;
    const x = geom.sx + Math.cos(angle) * geom.radius * (0.58 + rnd() * 0.42);
    const y = geom.sy + Math.sin(angle) * geom.radius * (0.16 + rnd() * 0.1) * cloud.verticalGrowth;
    ctx.strokeStyle = `rgba(235, 235, 222, ${alpha * 0.12 * cloud.softness})`;
    ctx.lineWidth = 3 + rnd() * 8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + Math.cos(angle) * geom.radius * 0.16, y + Math.sin(now * 0.001 + i) * 8, x + Math.cos(angle) * geom.radius * 0.42, y + (rnd() - 0.5) * 26, x + Math.cos(angle) * geom.radius * 0.72, y + (rnd() - 0.5) * 38);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCloudVeil(cloud, geom, alpha) {
  const cool = cloud.temperature < 0;
  drawCloudMass({ x: geom.sx, y: geom.sy, rx: geom.radius * 1.25, ry: geom.radius * 0.34 * cloud.verticalGrowth, color: cool ? 'rgba(204, 216, 218, ALPHA)' : 'rgba(234, 226, 204, ALPHA)', alpha: alpha * 0.2, softness: cloud.softness });
}

// Monta cada nuvem por camadas de massa, sombra, luz, véu e evaporação.
function drawCloud(cloud, nowMs) {
  const fade = dissolveFactor(cloud, Date.now());
  if (fade <= 0) return;
  const geom = cloudGeometry(cloud, nowMs);
  const alpha = cloud.opacity * fade * (0.34 + geom.depth * 0.66) * (cloud.ambient ? 0.72 : 1);
  const rnd = randomFrom(cloud.seed);
  ctx.save();
  ctx.filter = `blur(${1.4 + cloud.softness * 2.2}px)`;
  drawCloudVeil(cloud, geom, alpha);
  for (let i = 0; i < QUALITY.cloudMassCount * (0.55 + cloud.density * 0.45); i += 1) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.56);
    const x = geom.sx + Math.cos(a) * r * geom.radius * (0.92 + rnd() * 0.28);
    const y = geom.sy + Math.sin(a) * r * geom.radius * (0.22 + rnd() * 0.12) * cloud.verticalGrowth;
    const warm = cloud.temperature > 0;
    drawCloudMass({ x, y, rx: geom.radius * (0.13 + rnd() * 0.18), ry: geom.radius * (0.07 + rnd() * 0.13), color: warm ? 'rgba(242, 235, 215, ALPHA)' : 'rgba(224, 231, 229, ALPHA)', alpha: alpha * (0.16 + rnd() * 0.24), softness: cloud.softness });
  }
  ctx.filter = 'none';
  drawCloudInternalShadow(cloud, geom, alpha);
  drawCloudLight(cloud, geom, alpha);
  drawCloudFilaments(cloud, geom, alpha, nowMs);
  if (!cloud.ambient && cloud.text && alpha > 0.22) {
    ctx.fillStyle = `rgba(75, 83, 78, ${alpha * 0.035})`;
    ctx.font = `${Math.max(10, geom.radius * 0.055)}px Georgia, serif`;
    ctx.fillText(cloud.text.slice(0, 32), geom.sx + geom.radius * 0.32, geom.sy + geom.radius * 0.32);
  }
  ctx.restore();
}

// Projeta a arquitetura das nuvens sobre a terra conforme distância, escala e densidade.
function drawCloudShadows(activeClouds, nowMs) {
  const horizon = height * 0.76;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  activeClouds.forEach((cloud) => {
    const geom = cloudGeometry(cloud, nowMs);
    const alpha = (1 - cloud.distance) * cloud.shadowMass * cloud.density * 0.16 * cloud.opacity;
    const shadowY = horizon + (1 - cloud.distance) * height * 0.15 + cloud.y * 16;
    const g = ctx.createRadialGradient(geom.sx, shadowY, 0, geom.sx, shadowY, geom.radius * 1.8);
    g.addColorStop(0, `rgba(45, 54, 39, ${alpha})`);
    g.addColorStop(0.58, `rgba(61, 65, 47, ${alpha * 0.35})`);
    g.addColorStop(1, 'rgba(61, 65, 47, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(geom.sx, shadowY, geom.radius * (1.5 + cloud.scale * 0.22), geom.radius * 0.22, -0.05, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawAtmosphericHaze() {
  const horizon = height * 0.76;
  const haze = ctx.createLinearGradient(0, horizon - height * 0.16, 0, horizon + height * 0.1);
  haze.addColorStop(0, 'rgba(238, 232, 214, 0)');
  haze.addColorStop(0.5, 'rgba(238, 232, 214, 0.23)');
  haze.addColorStop(1, 'rgba(238, 232, 214, 0.05)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon - height * 0.16, width, height * 0.3);
}

// Grão e vinheta leves para aproximar o Canvas de tela/óleo sem sacrificar FPS.
function drawCanvasTexture() {
  const rnd = randomFrom(textureSeed);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  for (let i = 0; i < QUALITY.textureGrainCount; i += 1) {
    const x = rnd() * width;
    const y = rnd() * height;
    const alpha = 0.012 + rnd() * 0.022;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255, 250, 232, ${alpha})` : `rgba(62, 64, 55, ${alpha})`;
    ctx.fillRect(x, y, 0.7 + rnd() * 1.8, 0.5 + rnd() * 2.2);
  }
  ctx.globalCompositeOperation = 'source-over';
  const vignette = ctx.createRadialGradient(width * 0.5, height * 0.46, width * 0.2, width * 0.5, height * 0.5, width * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(47, 42, 34, 0.12)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// Mantém a obra viva sem visitantes e reduz a presença ambiente quando há interação.
function createAmbientClouds() {
  const visitorCount = [...clouds.values()].filter((cloud) => !cloud.ambient).length;
  const target = visitorCount ? 2 : 5;
  while (ambientClouds.length < target) {
    const seed = hashString(`ambiente-${Date.now()}-${ambientClouds.length}`);
    const rnd = randomFrom(seed);
    ambientClouds.push(normalizeCloud({
      id: `ambient-${seed}`,
      text: ['vento baixo', 'céu antigo', 'luz seca', 'campo suspenso'][ambientClouds.length % 4],
      x: rnd(), y: 0.14 + rnd() * 0.36, scale: 0.65 + rnd() * 0.7, distance: 0.56 + rnd() * 0.35,
      density: 0.24 + rnd() * 0.26, drift: 0.006 + rnd() * 0.015, opacity: 0.22 + rnd() * 0.22,
      luminosity: 0.48 + rnd() * 0.28, shadowMass: 0.16 + rnd() * 0.2, life: 1000 * 60 * 60, ambient: true, seed,
      createdAt: Date.now() - rnd() * 1000 * 60 * 10,
    }));
  }
  ambientClouds.splice(target);
  return ambientClouds;
}

// Atualiza deriva, evaporação local e remoção suave sem interferir no estado WebSocket.
function updateClouds(deltaTime) {
  clouds.forEach((cloud, id) => {
    const age = Date.now() - cloud.createdAt;
    if (cloud.dissolvingFrom && Date.now() - cloud.dissolvingFrom > 9000) clouds.delete(id);
    if (age > (cloud.life || CLOUD_TTL) + EVAPORATION_TIME) clouds.delete(id);
    cloud.updatedAt = cloud.updatedAt || Date.now();
    cloud.y = clamp(cloud.y + Math.sin(performance.now() * 0.00008 + cloud.phase) * deltaTime * 0.000002, 0.02, 0.88, cloud.y);
  });
}

// Loop pictórico: tempo, profundidade, paisagem, sombras, véus e textura.
function render(nowMs) {
  const deltaTime = Math.min(80, nowMs - lastTime);
  lastTime = nowMs;
  updateClouds(deltaTime);
  const activeClouds = [...clouds.values(), ...createAmbientClouds()].sort((a, b) => b.distance - a.distance);
  drawSky();
  activeClouds.filter((cloud) => cloud.distance > 0.52).forEach((cloud) => drawCloud(cloud, nowMs));
  drawPlanalto();
  drawCloudShadows(activeClouds, nowMs);
  activeClouds.filter((cloud) => cloud.distance <= 0.52).forEach((cloud) => drawCloud(cloud, nowMs));
  drawAtmosphericHaze();
  drawCanvasTexture();
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
