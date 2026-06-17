const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

const PORT = Number(process.env.PORT) || 3000;
const MAX_CLOUDS = 80;
const TEXT_LIMIT = 80;
const CLOUD_TTL_MIN = 1000 * 60 * 4;
const CLOUD_TTL_MAX = 1000 * 60 * 10;
const CLOUD_TTL = 1000 * 60 * 6;
const EVAPORATION_TIME = 1000 * 60 * 2;
const RATE_LIMITS = {
  'agent:join': { windowMs: 1000, max: 3 },
  'cloud:create': { windowMs: 10000, max: 3 },
  'cloud:update': { windowMs: 1000, max: 8 },
  'cloud:remove': { windowMs: 3000, max: 3 },
  'scene:reset': { windowMs: 10000, max: 2 },
};

/** In-memory scene state. No personal data is stored. */
const agents = new Map();
const clouds = new Map();
const rateBuckets = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/participar', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'participar.html')));
app.get('/exhibition', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'exhibition.html')));

function log(message, details = {}) {
  const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`[nuvens] ${message}${suffix}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_LIMIT);
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed, salt = 0) {
  let state = (seed + Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 2246822507);
  state = Math.imul(state ^ (state >>> 13), 3266489909);
  return ((state ^ (state >>> 16)) >>> 0) / 4294967295;
}

function textToAtmosphericSeed(text) {
  const sanitized = sanitizeText(text);
  const base = sanitized || 'silencio atmosferico';
  const textSeed = hashString(base);
  const letters = [...base.toLowerCase()].filter((char) => /[a-záàâãéêíóôõúüç]/i.test(char));
  const vowels = letters.filter((char) => 'aeiouáàâãéêíóôõúü'.includes(char)).length;
  const vowelRatio = letters.length ? vowels / letters.length : 0.42;
  const lengthRatio = Math.min(1, sanitized.length / TEXT_LIMIT);
  return {
    text: sanitized,
    textSeed,
    seed: textSeed,
    density: clamp(0.28 + lengthRatio * 0.46 + seededUnit(textSeed, 1) * 0.2, 0.15, 1, 0.55),
    verticalGrowth: clamp(0.38 + seededUnit(textSeed, 2) * 0.5 + lengthRatio * 0.24, 0.2, 1.25, 0.64),
    softness: clamp(0.36 + vowelRatio * 0.44 + seededUnit(textSeed, 3) * 0.18, 0.25, 1, 0.66),
    luminosity: clamp(0.38 + seededUnit(textSeed, 4) * 0.48 + (1 - lengthRatio) * 0.08, 0.2, 1, 0.58),
    drift: clamp((seededUnit(textSeed, 5) - 0.5) * 0.16, -0.35, 0.35, 0.035),
    temperature: clamp((seededUnit(textSeed, 6) - 0.5) * 2, -1, 1, 0),
    shadowMass: clamp(0.22 + lengthRatio * 0.42 + seededUnit(textSeed, 7) * 0.26, 0.1, 1, 0.46),
    outlineStrength: clamp(0.32 + seededUnit(textSeed, 9) * 0.5 + (1 - vowelRatio) * 0.18, 0.18, 1, 0.55),
    brushRhythm: clamp(0.28 + seededUnit(textSeed, 10) * 0.55 + lengthRatio * 0.22, 0.15, 1, 0.55),
    curvature: clamp(0.24 + vowelRatio * 0.42 + seededUnit(textSeed, 11) * 0.34, 0.12, 1, 0.5),
    lobeCount: Math.round(clamp(4 + lengthRatio * 5 + seededUnit(textSeed, 12) * 4, 4, 13, 7)),
    life: Math.round(CLOUD_TTL_MIN + seededUnit(textSeed, 8) * (CLOUD_TTL_MAX - CLOUD_TTL_MIN)),
  };
}

function serializeScene() {
  return {
    clouds: [...clouds.values()],
    agents: [...agents.keys()],
    maxClouds: MAX_CLOUDS,
    serverTime: Date.now(),
  };
}

function validateCloudPayload(payload = {}) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    text: sanitizeText(source.text),
    x: clamp(source.x, 0, 1, 0.5),
    y: clamp(source.y, 0, 1, 0.45),
    scale: clamp(source.scale, 0.35, 2.8, 1),
    distance: clamp(source.distance, 0, 1, 0.45),
    density: clamp(source.density, 0.15, 1, 0.55),
    drift: clamp(source.drift, -0.35, 0.35, 0.035),
    luminosity: clamp(source.luminosity, 0.2, 1, 0.58),
    shadowMass: clamp(source.shadowMass, 0.1, 1, 0.46),
    opacity: clamp(source.opacity, 0.12, 0.92, 0.74),
    outlineStrength: clamp(source.outlineStrength, 0.18, 1, undefined),
    brushRhythm: clamp(source.brushRhythm, 0.15, 1, undefined),
    curvature: clamp(source.curvature, 0.12, 1, undefined),
    lobeCount: Math.round(clamp(source.lobeCount, 4, 13, undefined)),
  };
}

function checkRateLimit(socket, eventName) {
  const limit = RATE_LIMITS[eventName];
  if (!limit) return { ok: true };
  const now = Date.now();
  const key = `${socket.id}:${eventName}`;
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + limit.windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + limit.windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count <= limit.max) return { ok: true };
  log('evento bloqueado por limite de frequência', { event: eventName, socketId: socket.id });
  return { ok: false, error: 'Aguarde alguns segundos antes de enviar novamente.' };
}

function withGuard(socket, eventName, acknowledge, handler) {
  const rate = checkRateLimit(socket, eventName);
  if (!rate.ok) {
    if (typeof acknowledge === 'function') acknowledge(rate);
    return;
  }
  try {
    handler();
  } catch (error) {
    log('erro de conexão', { event: eventName, socketId: socket.id, message: error.message });
    if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Erro temporário no servidor.' });
  }
}

function removeCloud(id, reason = 'removed') {
  const cloud = clouds.get(id);
  if (!cloud) return;
  clouds.delete(id);
  io.emit('cloud:remove', { id, reason });
}

function enforceCloudLimit() {
  while (clouds.size > MAX_CLOUDS) {
    const oldest = [...clouds.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) return;
    removeCloud(oldest.id, 'capacity');
  }
}

function removeAgentCloud(agentId, reason = 'agent:disconnect') {
  for (const cloud of clouds.values()) {
    if (cloud.agentId === agentId) removeCloud(cloud.id, reason);
  }
}

io.on('connection', (socket) => {
  socket.emit('scene:state', serializeScene());

  socket.on('agent:join', (_payload, acknowledge) => withGuard(socket, 'agent:join', acknowledge, () => {
    agents.set(socket.id, { id: socket.id, joinedAt: Date.now() });
    log('visitante conectado', { socketId: socket.id, visitors: agents.size });
    socket.emit('scene:state', serializeScene());
    if (typeof acknowledge === 'function') acknowledge({ ok: true, agentId: socket.id });
  }));

  socket.on('cloud:create', (payload, acknowledge) => withGuard(socket, 'cloud:create', acknowledge, () => {
    agents.set(socket.id, agents.get(socket.id) || { id: socket.id, joinedAt: Date.now() });
    const data = validateCloudPayload(payload);
    if (!data.text) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'A frase não pode ficar vazia.' });
      return;
    }

    removeAgentCloud(socket.id, 'replaced');
    const now = Date.now();
    const atmosphere = textToAtmosphericSeed(data.text);
    const cloud = {
      id: `${socket.id}-${now}`,
      agentId: socket.id,
      ...data,
      ...atmosphere,
      drift: clamp(payload?.drift, -0.35, 0.35, atmosphere.drift),
      luminosity: clamp(payload?.luminosity, 0.2, 1, atmosphere.luminosity),
      shadowMass: clamp(payload?.shadowMass, 0.1, 1, atmosphere.shadowMass),
      outlineStrength: clamp(data.outlineStrength, 0.18, 1, atmosphere.outlineStrength),
      brushRhythm: clamp(data.brushRhythm, 0.15, 1, atmosphere.brushRhythm),
      curvature: clamp(data.curvature, 0.12, 1, atmosphere.curvature),
      lobeCount: Math.round(clamp(data.lobeCount, 4, 13, atmosphere.lobeCount)),
      ambient: false,
      createdAt: now,
      updatedAt: now,
    };
    clouds.set(cloud.id, cloud);
    enforceCloudLimit();
    io.emit('cloud:create', cloud);
    log('nuvem criada', { cloudId: cloud.id, clouds: clouds.size });
    if (typeof acknowledge === 'function') acknowledge({ ok: true, cloud, agentId: socket.id });
  }));

  socket.on('cloud:update', (payload, acknowledge) => withGuard(socket, 'cloud:update', acknowledge, () => {
    const cloud = [...clouds.values()].find((item) => item.agentId === socket.id);
    if (!cloud) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Nenhuma nuvem ativa para este visitante.' });
      return;
    }
    const data = validateCloudPayload({ ...cloud, ...(isPlainObject(payload) ? payload : {}) });
    Object.assign(cloud, {
      x: data.x,
      y: data.y,
      scale: data.scale,
      distance: data.distance,
      density: data.density,
      drift: data.drift,
      luminosity: data.luminosity,
      shadowMass: data.shadowMass,
      opacity: data.opacity,
      outlineStrength: clamp(data.outlineStrength, 0.18, 1, cloud.outlineStrength),
      brushRhythm: clamp(data.brushRhythm, 0.15, 1, cloud.brushRhythm),
      curvature: clamp(data.curvature, 0.12, 1, cloud.curvature),
      lobeCount: Math.round(clamp(data.lobeCount, 4, 13, cloud.lobeCount)),
      updatedAt: Date.now(),
    });
    clouds.set(cloud.id, cloud);
    io.emit('cloud:update', cloud);
    if (typeof acknowledge === 'function') acknowledge({ ok: true, cloud });
  }));

  socket.on('cloud:remove', (_payload, acknowledge) => withGuard(socket, 'cloud:remove', acknowledge, () => {
    removeAgentCloud(socket.id, 'visitor');
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('scene:request-state', (_payload, acknowledge) => withGuard(socket, 'scene:request-state', acknowledge, () => {
    socket.emit('scene:state', serializeScene());
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('scene:reset', (_payload, acknowledge) => withGuard(socket, 'scene:reset', acknowledge, () => {
    clouds.clear();
    log('reset de cena', { socketId: socket.id });
    io.emit('scene:reset', { at: Date.now() });
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('error', (error) => log('erro de conexão', { socketId: socket.id, message: error.message }));

  socket.on('disconnect', (reason) => {
    agents.delete(socket.id);
    removeAgentCloud(socket.id, 'agent:disconnect');
    rateBuckets.forEach((_value, key) => {
      if (key.startsWith(`${socket.id}:`)) rateBuckets.delete(key);
    });
    io.emit('agent:disconnect', { agentId: socket.id });
    log('erro de conexão', { socketId: socket.id, reason });
  });
});

/** Evaporate old clouds: opacity fades before removal, then all clients are updated. */
setInterval(() => {
  const now = Date.now();
  for (const cloud of clouds.values()) {
    const age = now - cloud.createdAt;
    const ttl = clamp(cloud.life, CLOUD_TTL_MIN, CLOUD_TTL_MAX, CLOUD_TTL);
    if (age > ttl + EVAPORATION_TIME) {
      removeCloud(cloud.id, 'evaporated');
    } else if (age > ttl) {
      const fade = 1 - (age - ttl) / EVAPORATION_TIME;
      cloud.opacity = Math.max(0, Math.min(cloud.opacity, fade * 0.65));
      cloud.updatedAt = now;
      io.emit('cloud:update', cloud);
    }
  }
}, 5000);

server.listen(PORT, () => {
  log('servidor iniciado', { port: PORT, nodeEnv: process.env.NODE_ENV });
});
