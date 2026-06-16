const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const clouds = new Map();
const connectionStatus = document.querySelector('#connectionStatus');
const contemplativeTexts = ['luz suspensa', 'vento baixo', 'campo aberto', 'céu antigo', 'sombra úmida'];
const CLOUD_TTL = 1000 * 60 * 6;
const EVAPORATION_TIME = 1000 * 60 * 2;
const MAX_CLUSTER_WEIGHT = 3.15;
let dpr = 1;
let lastTime = performance.now();

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

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function withAtmosphere(cloud) {
  const seed = hashString(`${cloud.id}:${cloud.text}`);
  return {
    ...cloud,
    phase: cloud.phase ?? randomFrom(seed)() * Math.PI * 2,
    seed,
    bornAtClient: cloud.bornAtClient || Date.now(),
    xOffset: cloud.xOffset || 0,
    yOffset: cloud.yOffset || 0,
  };
}

function setConnectionError(message) {
  if (!connectionStatus) return;
  connectionStatus.textContent = message;
  connectionStatus.hidden = !message;
}

function rebuildScene() {
  socket.emit('agent:join', {}, (response) => {
    if (!response?.ok) setConnectionError(response?.error || 'Conexão instável. Tentando reconstruir a cena…');
  });
}

socket.on('connect', () => {
  setConnectionError('');
  rebuildScene();
});
socket.io.on('reconnect', () => {
  setConnectionError('');
  rebuildScene();
});
socket.io.on('reconnect_attempt', () => setConnectionError('Reconectando à cena…'));
socket.io.on('reconnect_error', () => setConnectionError('Conexão instável. A cena será restaurada automaticamente.'));
socket.io.on('reconnect_failed', () => setConnectionError('Sem conexão com o servidor. Verifique a rede local.'));
socket.on('disconnect', () => setConnectionError('Reconectando à cena…'));
socket.on('connect_error', () => setConnectionError('Conexão instável. Tentando novamente…'));
socket.on('scene:state', (state) => {
  clouds.clear();
  (state.clouds || []).forEach((cloud) => clouds.set(cloud.id, withAtmosphere(cloud)));
});
socket.on('cloud:create', (cloud) => clouds.set(cloud.id, withAtmosphere(cloud)));
socket.on('cloud:update', (cloud) => clouds.set(cloud.id, withAtmosphere({ ...(clouds.get(cloud.id) || {}), ...cloud })));
socket.on('cloud:remove', ({ id }) => {
  const cloud = clouds.get(id);
  if (cloud) clouds.set(id, { ...cloud, dissolvingFrom: Date.now() });
});
socket.on('scene:reset', () => clouds.clear());

function sky() {
  const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
  g.addColorStop(0, '#dbe5e8');
  g.addColorStop(0.28, '#d2dde0');
  g.addColorStop(0.58, '#ddd8ca');
  g.addColorStop(0.77, '#c8bea2');
  g.addColorStop(1, '#817d5d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const glow = ctx.createRadialGradient(innerWidth * 0.18, innerHeight * 0.24, 0, innerWidth * 0.18, innerHeight * 0.24, innerWidth * 0.72);
  glow.addColorStop(0, 'rgba(248, 243, 224, 0.28)');
  glow.addColorStop(0.46, 'rgba(235, 230, 210, 0.10)');
  glow.addColorStop(1, 'rgba(235, 230, 210, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const horizon = innerHeight * 0.76;
  const land = ctx.createLinearGradient(0, horizon, 0, innerHeight);
  land.addColorStop(0, 'rgba(116, 109, 77, 0.28)');
  land.addColorStop(0.62, 'rgba(78, 83, 55, 0.48)');
  land.addColorStop(1, 'rgba(45, 55, 39, 0.58)');
  ctx.fillStyle = land;
  ctx.fillRect(0, horizon, innerWidth, innerHeight - horizon);
  ctx.fillStyle = 'rgba(237, 225, 193, 0.16)';
  ctx.fillRect(0, horizon - 1.5, innerWidth, 3);
}

function contemplativeClouds(now) {
  if (clouds.size) return [];
  return contemplativeTexts.map((label, i) => withAtmosphere({
    id: `system-${i}`,
    text: label,
    x: ((now * 0.0000025 * (i + 1)) + i * 0.19) % 1,
    y: 0.12 + i * 0.052,
    scale: 0.78 + i * 0.09,
    distance: 0.68 + (i % 2) * 0.18,
    density: 0.34,
    drift: 0.012,
    opacity: 0.28,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}

function reorganizeClouds(activeClouds, now) {
  const cells = new Map();
  activeClouds.forEach((cloud) => {
    const key = `${Math.floor(cloud.x * 4)}:${Math.floor(cloud.y * 4)}`;
    const weight = cells.get(key) || 0;
    const desiredShift = Math.max(0, weight - MAX_CLUSTER_WEIGHT) * 0.0018;
    const direction = (cloud.seed % 2 ? 1 : -1) * (0.55 + (cloud.seed % 11) / 20);
    cloud.xOffset = Math.max(-0.14, Math.min(0.14, (cloud.xOffset || 0) + desiredShift * direction));
    cloud.yOffset = Math.max(-0.04, Math.min(0.06, (cloud.yOffset || 0) + desiredShift * Math.sin(now * 0.00004 + cloud.phase)));
    cells.set(key, weight + cloud.scale * (1.15 - cloud.distance));
  });
}

function dissolveFactor(cloud, nowMs) {
  const age = nowMs - (cloud.createdAt || cloud.bornAtClient || nowMs);
  const serverFade = age > CLOUD_TTL ? Math.max(0, 1 - (age - CLOUD_TTL) / EVAPORATION_TIME) : 1;
  const removalFade = cloud.dissolvingFrom ? Math.max(0, 1 - (nowMs - cloud.dissolvingFrom) / 9000) : 1;
  if (cloud.dissolvingFrom && removalFade <= 0) clouds.delete(cloud.id);
  return Math.min(serverFade, removalFade);
}

function drawShadow(cloud, sx, radius, alpha) {
  const horizon = innerHeight * 0.76;
  const shadowY = horizon + (1 - cloud.distance) * innerHeight * 0.13 + cloud.y * 18;
  ctx.save();
  ctx.translate(sx + radius * 0.1, shadowY);
  ctx.rotate(-0.025);
  ctx.scale(2.2 + cloud.scale * 0.28, 0.22 + (1 - cloud.distance) * 0.11);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  g.addColorStop(0, `rgba(42, 45, 34, ${0.12 * (1 - cloud.distance) * alpha})`);
  g.addColorStop(0.58, `rgba(42, 45, 34, ${0.045 * (1 - cloud.distance) * alpha})`);
  g.addColorStop(1, 'rgba(42, 45, 34, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloud(cloud, now, nowWall) {
  const fade = dissolveFactor(cloud, nowWall);
  if (fade <= 0) return;
  const depth = 1 - cloud.distance;
  const radius = (94 + cloud.text.length * 4.8) * cloud.scale * (0.46 + depth * 1.08);
  const drift = now * (cloud.drift || 0.01) * (22 + depth * 28);
  const sx = (((cloud.x + (cloud.xOffset || 0)) * innerWidth + drift) % (innerWidth + radius * 2)) - radius;
  const sy = (0.07 + (cloud.y + (cloud.yOffset || 0)) * 0.56) * innerHeight;
  const alphaBase = (cloud.opacity || 0.45) * fade * (0.26 + depth * 0.78);
  drawShadow(cloud, sx, radius, alphaBase);

  const words = cloud.text.split(/\s+/).filter(Boolean);
  const fragments = [...words, ...words.map((word) => word.slice(0, Math.max(3, Math.ceil(word.length * 0.62))))];
  const particles = Math.floor(34 + cloud.density * 138 + depth * 28);
  const rnd = randomFrom(cloud.seed);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < particles; i += 1) {
    const edgeBias = i % 5 === 0 ? 0.92 : Math.pow(rnd(), 0.62);
    const angle = rnd() * Math.PI * 2 + Math.sin(now * 0.035 + i) * 0.025 + cloud.phase;
    const filament = i % 9 === 0 ? 1.28 + rnd() * 0.42 : 1;
    const px = sx + Math.cos(angle) * edgeBias * radius * (1.18 + rnd() * 0.32) * filament + Math.sin(now * 0.07 + i) * (2 + depth * 6);
    const py = sy + Math.sin(angle) * edgeBias * radius * (0.32 + rnd() * 0.16) + Math.cos(now * 0.05 + i) * (1 + depth * 4);
    const size = (7 + rnd() * 12 + depth * 17) * cloud.scale * (i % 7 === 0 ? 1.28 : 1);
    const legibility = cloud.distance > 0.68 ? 0.46 : 0.82;
    const alpha = alphaBase * legibility * (0.18 + rnd() * 0.55) * (i % 9 === 0 ? 0.55 : 1);
    ctx.font = `${Math.max(6, size)}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = `rgba(244, 244, 236, ${alpha})`;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((rnd() - 0.5) * 0.32);
    ctx.fillText(fragments[i % fragments.length], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function frame(nowMs) {
  lastTime = nowMs;
  const nowWall = Date.now();
  sky();
  const activeClouds = [...clouds.values(), ...contemplativeClouds(nowMs)].sort((a, b) => b.distance - a.distance);
  reorganizeClouds(activeClouds, nowMs);
  activeClouds.forEach((cloud) => drawCloud(cloud, nowMs / 1000, nowWall));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
