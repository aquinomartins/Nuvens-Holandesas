const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 25000,
  pingTimeout: 20000,
});

const PORT = process.env.PORT || 3000;
const MAX_CLOUDS = 80;
const TEXT_LIMIT = 80;
const CLOUD_TTL = 1000 * 60 * 6;
const EVAPORATION_TIME = 1000 * 60 * 2;

/** In-memory scene state. For an exhibition install this keeps all screens synced. */
const agents = new Map();
const clouds = new Map();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/participar', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'participar.html')));
app.get('/exhibition', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'exhibition.html')));

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
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
  return {
    text: sanitizeText(payload.text),
    x: clamp(payload.x, 0, 1, 0.5),
    y: clamp(payload.y, 0, 1, 0.45),
    scale: clamp(payload.scale, 0.35, 2.8, 1),
    distance: clamp(payload.distance, 0, 1, 0.45),
    density: clamp(payload.density, 0.15, 1, 0.55),
    drift: clamp(payload.drift, -0.35, 0.35, 0.035),
    opacity: clamp(payload.opacity, 0.12, 0.92, 0.74),
  };
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

  socket.on('agent:join', (_payload, acknowledge) => {
    agents.set(socket.id, { id: socket.id, joinedAt: Date.now() });
    socket.emit('scene:state', serializeScene());
    if (typeof acknowledge === 'function') acknowledge({ agentId: socket.id });
  });

  socket.on('cloud:create', (payload, acknowledge) => {
    agents.set(socket.id, agents.get(socket.id) || { id: socket.id, joinedAt: Date.now() });
    const data = validateCloudPayload(payload);
    if (!data.text) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'A frase não pode ficar vazia.' });
      return;
    }

    removeAgentCloud(socket.id, 'replaced');
    const now = Date.now();
    const cloud = {
      id: `${socket.id}-${now}`,
      agentId: socket.id,
      text: data.text,
      x: data.x,
      y: data.y,
      scale: data.scale,
      distance: data.distance,
      density: data.density,
      drift: data.drift,
      opacity: data.opacity,
      createdAt: now,
      updatedAt: now,
    };
    clouds.set(cloud.id, cloud);
    enforceCloudLimit();
    io.emit('cloud:create', cloud);
    if (typeof acknowledge === 'function') acknowledge({ ok: true, cloud, agentId: socket.id });
  });

  socket.on('cloud:update', (payload, acknowledge) => {
    const cloud = [...clouds.values()].find((item) => item.agentId === socket.id);
    if (!cloud) {
      if (typeof acknowledge === 'function') acknowledge({ ok: false, error: 'Nenhuma nuvem ativa para este visitante.' });
      return;
    }
    const data = validateCloudPayload({ ...cloud, ...payload });
    Object.assign(cloud, data, { text: cloud.text, updatedAt: Date.now() });
    clouds.set(cloud.id, cloud);
    io.emit('cloud:update', cloud);
    if (typeof acknowledge === 'function') acknowledge({ ok: true, cloud });
  });

  socket.on('cloud:remove', (_payload, acknowledge) => {
    removeAgentCloud(socket.id, 'visitor');
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('scene:reset', (_payload, acknowledge) => {
    clouds.clear();
    io.emit('scene:reset', { at: Date.now() });
    if (typeof acknowledge === 'function') acknowledge({ ok: true });
  });

  socket.on('disconnect', () => {
    agents.delete(socket.id);
    removeAgentCloud(socket.id, 'agent:disconnect');
    io.emit('agent:disconnect', { agentId: socket.id });
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
  console.log(`Nuvens Holandesas ouvindo em http://localhost:${PORT}`);
});
