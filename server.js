const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { OBJECT_PNG_ASSETS } = require('./objectPngAssets');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

const PORT = Number(process.env.PORT) || 3000;
const MAX_OBJECTS = 80;
const OBJECT_TTL_MIN = 1000 * 60 * 6;
const OBJECT_TTL_MAX = 1000 * 60 * 14;
const OBJECT_TTL = 1000 * 60 * 9;
const EVAPORATION_TIME = 1000 * 60 * 2;
const ZONES = {
  upper: { xMin: 0.05, xMax: 0.95, yMin: 0.05, yMax: 0.38 },
  middle: { xMin: 0.08, xMax: 0.92, yMin: 0.30, yMax: 0.65 },
  lower: { xMin: 0.08, xMax: 0.92, yMin: 0.58, yMax: 0.92 },
};
const OBJECT_TYPES = {
  green_bundle: { zone: 'lower', scaleMin: 0.42, scaleMax: 1.28, rotationMin: -18, rotationMax: 18, opacityMin: 0.45, opacityMax: 0.95 },
  red_cone: { zone: 'middle', scaleMin: 0.36, scaleMax: 1.08, rotationMin: -24, rotationMax: 24, opacityMin: 0.5, opacityMax: 0.96 },
  yellow_blue_artifact: { zone: 'upper', scaleMin: 0.34, scaleMax: 1.0, rotationMin: -14, rotationMax: 14, opacityMin: 0.48, opacityMax: 0.94 },
};
const RATE_LIMITS = {
  'agent:join': { windowMs: 1000, max: 3 },
  'object:create': { windowMs: 10000, max: 3 },
  'object:update': { windowMs: 1000, max: 8 },
  'object:remove': { windowMs: 3000, max: 3 },
  'scene:reset': { windowMs: 10000, max: 2 },
};

/** In-memory scene state. No personal data is stored. */
const agents = new Map();
const objects = new Map();
const rateBuckets = new Map();

app.get('/assets/objects/:objectName.png', (req, res) => {
  const asset = OBJECT_PNG_ASSETS[req.params.objectName];
  if (!asset) {
    res.status(404).end();
    return;
  }
  res
    .type('png')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .send(Buffer.from(asset, 'base64'));
});

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

function serializeScene() {
  return {
    objects: [...objects.values()],
    agents: [...agents.keys()],
    maxObjects: MAX_OBJECTS,
    zones: ZONES,
    objectTypes: OBJECT_TYPES,
    serverTime: Date.now(),
  };
}

function validateObjectPayload(payload = {}, existing = null) {
  const source = isPlainObject(payload) ? payload : {};
  const type = Object.prototype.hasOwnProperty.call(OBJECT_TYPES, source.type) ? source.type : existing?.type;
  const config = OBJECT_TYPES[type] || OBJECT_TYPES.green_bundle;
  const zone = ZONES[config.zone];
  return {
    type: type || 'green_bundle',
    zone: config.zone,
    x: clamp(source.x, zone.xMin, zone.xMax, existing?.x ?? (zone.xMin + zone.xMax) / 2),
    y: clamp(source.y, zone.yMin, zone.yMax, existing?.y ?? (zone.yMin + zone.yMax) / 2),
    scale: clamp(source.scale, config.scaleMin, config.scaleMax, existing?.scale ?? 0.78),
    rotation: clamp(source.rotation, config.rotationMin, config.rotationMax, existing?.rotation ?? 0),
    opacity: clamp(source.opacity, config.opacityMin, config.opacityMax, existing?.opacity ?? 0.82),
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

function removeObject(id, reason = 'removed') {
  const object = objects.get(id);
  if (!object) return;
  objects.delete(id);
  io.emit('object:remove', { id, reason });
}

function enforceObjectLimit() {
  while (objects.size > MAX_OBJECTS) {
    const oldest = [...objects.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) return;
    removeObject(oldest.id, 'capacity');
  }
}

function removeAgentObject(agentId, reason = 'agent:disconnect') {
  for (const object of objects.values()) {
    if (object.agentId === agentId) removeObject(object.id, reason);
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

  socket.on('object:create', (payload, acknowledge) => withGuard(socket, 'object:create', acknowledge, () => {
    agents.set(socket.id, agents.get(socket.id) || { id: socket.id, joinedAt: Date.now() });
    const data = validateObjectPayload(payload);
    removeAgentObject(socket.id, 'replaced');
    const now = Date.now();
    const seed = hashString(`${data.type}:${socket.id}:${now}`);
    const object = {
      id: `${socket.id}-${now}`,
      agentId: socket.id,
      ...data,
      seed,
      life: Math.round(OBJECT_TTL_MIN + seededUnit(seed, 3) * (OBJECT_TTL_MAX - OBJECT_TTL_MIN)),
      createdAt: now,
      updatedAt: now,
    };
    objects.set(object.id, object);
    enforceObjectLimit();
    io.emit('object:create', object);
    log('objeto criado', { objectId: object.id, type: object.type, objects: objects.size });
    if (typeof acknowledge === 'function') acknowledge({ ok: true, object, agentId: socket.id });
  }));

  socket.on('object:update', (payload, acknowledge) => withGuard(socket, 'object:update', acknowledge, () => {
    const object = [...objects.values()].find((item) => item.agentId === socket.id);
    if (!object) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Nenhum objeto ativo para este visitante.' });
      return;
    }
    const data = validateObjectPayload({ ...object, ...(isPlainObject(payload) ? payload : {}) }, object);
    Object.assign(object, data, { updatedAt: Date.now() });
    objects.set(object.id, object);
    io.emit('object:update', object);
    if (typeof acknowledge === 'function') acknowledge({ ok: true, object });
  }));

  socket.on('object:remove', (_payload, acknowledge) => withGuard(socket, 'object:remove', acknowledge, () => {
    removeAgentObject(socket.id, 'visitor');
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('scene:request-state', (_payload, acknowledge) => withGuard(socket, 'scene:request-state', acknowledge, () => {
    socket.emit('scene:state', serializeScene());
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('scene:reset', (_payload, acknowledge) => withGuard(socket, 'scene:reset', acknowledge, () => {
    objects.clear();
    log('reset de cena', { socketId: socket.id });
    io.emit('scene:reset', { at: Date.now() });
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('error', (error) => log('erro de conexão', { socketId: socket.id, message: error.message }));

  socket.on('disconnect', (reason) => {
    agents.delete(socket.id);
    removeAgentObject(socket.id, 'agent:disconnect');
    rateBuckets.forEach((_value, key) => {
      if (key.startsWith(`${socket.id}:`)) rateBuckets.delete(key);
    });
    io.emit('agent:disconnect', { agentId: socket.id });
    log('visitante desconectado', { socketId: socket.id, reason });
  });
});

/** Fade old objects before removal, then all clients are updated. */
setInterval(() => {
  const now = Date.now();
  for (const object of objects.values()) {
    const age = now - object.createdAt;
    const ttl = clamp(object.life, OBJECT_TTL_MIN, OBJECT_TTL_MAX, OBJECT_TTL);
    if (age > ttl + EVAPORATION_TIME) {
      removeObject(object.id, 'expired');
    } else if (age > ttl) {
      const fade = 1 - (age - ttl) / EVAPORATION_TIME;
      object.opacity = Math.max(0, Math.min(object.opacity, fade * 0.65));
      object.updatedAt = now;
      io.emit('object:update', object);
    }
  }
}, 5000);

server.listen(PORT, () => {
  log('servidor iniciado', { port: PORT, nodeEnv: process.env.NODE_ENV });
});
