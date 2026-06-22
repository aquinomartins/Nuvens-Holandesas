const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { OBJECT_PNG_ASSETS } = require('./objectPngAssets');
const { CHARACTER_PNG_ASSETS } = require('./characterPngAssets');

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
const MAX_CHARACTERS = 80;
const OBJECT_TTL_MIN = 1000 * 60 * 6;
const OBJECT_TTL_MAX = 1000 * 60 * 14;
const OBJECT_TTL = 1000 * 60 * 9;
const CHARACTER_TTL_MIN = 1000 * 60 * 5;
const CHARACTER_TTL_MAX = 1000 * 60 * 12;
const CHARACTER_TTL = 1000 * 60 * 8;
const EVAPORATION_TIME = 1000 * 60 * 2;
const ZONES = {
  upper: { xMin: 0.05, xMax: 0.95, yMin: 0.05, yMax: 0.38 },
  middle: { xMin: 0.08, xMax: 0.92, yMin: 0.30, yMax: 0.65 },
  lower: { xMin: 0.08, xMax: 0.92, yMin: 0.58, yMax: 0.92 },
};
const CHARACTER_TYPES = {
  persona_01: { zone: 'lower', scaleMin: 0.42, scaleMax: 0.9, speedMin: 0.08, speedMax: 0.55, rhythmMin: 0.35, rhythmMax: 1.4, fieldMin: 0.18, fieldMax: 0.85, radiusMin: 0.07, radiusMax: 0.18, spriteIndex: 12, hue: 126 },
  persona_02: { zone: 'lower', scaleMin: 0.42, scaleMax: 0.9, speedMin: 0.04, speedMax: 0.42, rhythmMin: 0.25, rhythmMax: 1.15, fieldMin: 0.22, fieldMax: 1, radiusMin: 0.1, radiusMax: 0.24, spriteIndex: 44, hue: 194 },
  persona_03: { zone: 'lower', scaleMin: 0.42, scaleMax: 0.9, speedMin: 0.05, speedMax: 0.5, rhythmMin: 0.25, rhythmMax: 1.25, fieldMin: 0.2, fieldMax: 1, radiusMin: 0.09, radiusMax: 0.24, spriteIndex: 81, hue: 45 },
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
  'character:create': { windowMs: 10000, max: 4 },
  'character:update': { windowMs: 1000, max: 12 },
  'character:remove': { windowMs: 3000, max: 3 },
  'scene:reset': { windowMs: 10000, max: 2 },
};

/** In-memory scene state. No personal data is stored. */
const agents = new Map();
const objects = new Map();
const characters = new Map();
const rateBuckets = new Map();

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets'), {
  immutable: false,
  maxAge: 0,
  etag: true,
  setHeaders(res) {
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  },
}));

app.get('/assets/characters/:characterName.png', (req, res) => {
  const asset = CHARACTER_PNG_ASSETS[req.params.characterName];
  if (!asset) {
    res.status(404).end();
    return;
  }
  res
    .type('png')
    .set('Cache-Control', 'public, max-age=31536000, immutable')
    .send(Buffer.from(asset, 'base64'));
});

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
    characters: [...characters.values()],
    agents: [...agents.keys()],
    maxObjects: MAX_OBJECTS,
    zones: ZONES,
    objectTypes: OBJECT_TYPES,
    characterTypes: CHARACTER_TYPES,
    serverTime: Date.now(),
  };
}


function zoneForCharacter(zoneName) {
  if (zoneName === 'lowerMiddle') return { xMin: 0.08, xMax: 0.92, yMin: 0.46, yMax: 0.88 };
  return ZONES[zoneName] || ZONES.middle;
}

function validateCharacterPayload(payload = {}, existing = null) {
  const source = isPlainObject(payload) ? payload : {};
  const type = Object.prototype.hasOwnProperty.call(CHARACTER_TYPES, source.type) ? source.type : existing?.type;
  const config = CHARACTER_TYPES[type] || CHARACTER_TYPES.persona_01;
  const zoneName = source.allowedZone && (ZONES[source.allowedZone] || source.allowedZone === 'lowerMiddle') ? source.allowedZone : (existing?.allowedZone || config.zone);
  const zone = zoneForCharacter(zoneName);
  const x = clamp(source.x, zone.xMin, zone.xMax, existing?.x ?? (zone.xMin + zone.xMax) / 2);
  const y = clamp(source.y, zone.yMin, zone.yMax, existing?.y ?? (zone.yMin + zone.yMax) / 2);
  const direction = source.direction === 'left' ? 'left' : 'right';
  const speed = source.mode === 'rest' ? 0 : clamp(source.speed, config.speedMin, config.speedMax, existing?.speed ?? (config.speedMin + config.speedMax) / 2);
  return {
    type: type || 'persona_01',
    spriteKey: type || 'persona_01',
    spriteSource: 'personas',
    spriteIndex: clamp(source.spriteIndex, 0, 104, existing?.spriteIndex ?? config.spriteIndex),
    x,
    y,
    targetX: clamp(source.targetX, zone.xMin, zone.xMax, existing?.targetX ?? x),
    targetY: clamp(source.targetY, zone.yMin, zone.yMax, existing?.targetY ?? y),
    vx: clamp(source.vx, -0.02, 0.02, existing?.vx ?? 0),
    vy: clamp(source.vy, -0.02, 0.02, existing?.vy ?? 0),
    scale: clamp(source.scale, config.scaleMin, config.scaleMax, existing?.scale ?? 0.94),
    rotation: clamp(source.rotation, -10, 10, existing?.rotation ?? 0),
    direction,
    speed,
    rhythm: clamp(source.rhythm, config.rhythmMin, config.rhythmMax, existing?.rhythm ?? 0.7),
    fieldStrength: clamp(source.fieldStrength, config.fieldMin, config.fieldMax, existing?.fieldStrength ?? 0.55),
    fieldRadius: clamp(source.fieldRadius, config.radiusMin, config.radiusMax, existing?.fieldRadius ?? 0.15),
    mode: source.mode === 'rest' ? 'rest' : 'move',
    allowedZone: zoneName,
    zIndex: clamp(source.zIndex, 0, 1, existing?.zIndex ?? y),
    opacity: clamp(source.opacity, 0.25, 1, existing?.opacity ?? 0.9),
    frameIndex: 0,
    frameCount: 1,
    frameRate: 1,
    ambient: isPlainObject(source.ambient) ? source.ambient : existing?.ambient || { hue: config.hue },
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

function removeCharacter(id, reason = 'removed') {
  const character = characters.get(id);
  if (!character) return;
  characters.delete(id);
  io.emit('character:remove', { id, reason });
}

function removeObject(id, reason = 'removed') {
  const object = objects.get(id);
  if (!object) return;
  objects.delete(id);
  io.emit('object:remove', { id, reason });
}

function enforceCharacterLimit() {
  while (characters.size > MAX_CHARACTERS) {
    const oldest = [...characters.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) return;
    removeCharacter(oldest.id, 'capacity');
  }
}

function enforceObjectLimit() {
  while (objects.size > MAX_OBJECTS) {
    const oldest = [...objects.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) return;
    removeObject(oldest.id, 'capacity');
  }
}

function removeAgentCharacter(agentId, reason = 'agent:disconnect') {
  for (const character of characters.values()) {
    if (character.agentId === agentId) removeCharacter(character.id, reason);
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


  socket.on('character:create', (payload, acknowledge) => withGuard(socket, 'character:create', acknowledge, () => {
    agents.set(socket.id, agents.get(socket.id) || { id: socket.id, joinedAt: Date.now() });
    const data = validateCharacterPayload(payload);
    removeAgentCharacter(socket.id, 'replaced');
    const now = Date.now();
    const seed = hashString(`${data.type}:${socket.id}:${now}`);
    const character = {
      id: `${socket.id}-${now}`,
      agentId: socket.id,
      ...data,
      seed,
      life: Math.round(CHARACTER_TTL_MIN + seededUnit(seed, 5) * (CHARACTER_TTL_MAX - CHARACTER_TTL_MIN)),
      createdAt: now,
      updatedAt: now,
    };
    characters.set(character.id, character);
    enforceCharacterLimit();
    io.emit('character:create', character);
    log('personagem criado', { characterId: character.id, type: character.type, characters: characters.size });
    if (typeof acknowledge === 'function') acknowledge({ ok: true, character, agentId: socket.id });
  }));

  socket.on('character:update', (payload, acknowledge) => withGuard(socket, 'character:update', acknowledge, () => {
    const character = [...characters.values()].find((item) => item.agentId === socket.id);
    if (!character) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Nenhum personagem ativo para este visitante.' });
      return;
    }
    const data = validateCharacterPayload({ ...character, ...(isPlainObject(payload) ? payload : {}) }, character);
    Object.assign(character, data, { updatedAt: Date.now() });
    characters.set(character.id, character);
    io.emit('character:update', character);
    if (typeof acknowledge === 'function') acknowledge({ ok: true, character });
  }));

  socket.on('character:remove', (_payload, acknowledge) => withGuard(socket, 'character:remove', acknowledge, () => {
    removeAgentCharacter(socket.id, 'visitor');
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
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
    characters.clear();
    log('reset de cena', { socketId: socket.id });
    io.emit('scene:reset', { at: Date.now() });
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  }));

  socket.on('error', (error) => log('erro de conexão', { socketId: socket.id, message: error.message }));

  socket.on('disconnect', (reason) => {
    agents.delete(socket.id);
    removeAgentObject(socket.id, 'agent:disconnect');
    removeAgentCharacter(socket.id, 'agent:disconnect');
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
  for (const character of characters.values()) {
    const age = now - character.createdAt;
    const ttl = clamp(character.life, CHARACTER_TTL_MIN, CHARACTER_TTL_MAX, CHARACTER_TTL);
    if (age > ttl + EVAPORATION_TIME) {
      removeCharacter(character.id, 'expired');
    } else if (age > ttl) {
      const fade = 1 - (age - ttl) / EVAPORATION_TIME;
      character.opacity = Math.max(0, Math.min(character.opacity, fade * 0.65));
      character.updatedAt = now;
      io.emit('character:update', character);
    }
  }
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
