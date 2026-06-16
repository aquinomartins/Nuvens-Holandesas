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
    opacity: clamp(source.opacity, 0.12, 0.92, 0.74),
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
    const cloud = { id: `${socket.id}-${now}`, agentId: socket.id, ...data, createdAt: now, updatedAt: now };
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
    Object.assign(cloud, data, { text: cloud.text, updatedAt: Date.now() });
    clouds.set(cloud.id, cloud);
    io.emit('cloud:update', cloud);
    if (typeof acknowledge === 'function') acknowledge({ ok: true, cloud });
  }));

  socket.on('cloud:remove', (_payload, acknowledge) => withGuard(socket, 'cloud:remove', acknowledge, () => {
    removeAgentCloud(socket.id, 'visitor');
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
    if (age > CLOUD_TTL + EVAPORATION_TIME) {
      removeCloud(cloud.id, 'evaporated');
    } else if (age > CLOUD_TTL) {
      const fade = 1 - (age - CLOUD_TTL) / EVAPORATION_TIME;
      cloud.opacity = Math.max(0, Math.min(cloud.opacity, fade * 0.65));
      cloud.updatedAt = now;
      io.emit('cloud:update', cloud);
    }
  }
}, 5000);

server.listen(PORT, () => {
  log('servidor iniciado', { port: PORT, nodeEnv: process.env.NODE_ENV });
});
