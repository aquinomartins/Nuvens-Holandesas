const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
const socket = window.Nuvens.createSocket();
const clouds = new Map();
const contemplativeTexts = ['luz suspensa', 'vento baixo', 'campo aberto', 'céu antigo', 'sombra úmida'];
let dpr = 1;
let lastTime = performance.now();

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

socket.on('connect', () => socket.emit('agent:join'));
socket.on('scene:state', (state) => {
  clouds.clear();
  (state.clouds || []).forEach((cloud) => clouds.set(cloud.id, { ...cloud, phase: Math.random() * Math.PI * 2 }));
});
socket.on('cloud:create', (cloud) => clouds.set(cloud.id, { ...cloud, phase: Math.random() * Math.PI * 2 }));
socket.on('cloud:update', (cloud) => clouds.set(cloud.id, { ...(clouds.get(cloud.id) || {}), ...cloud }));
socket.on('cloud:remove', ({ id }) => clouds.delete(id));
socket.on('scene:reset', () => clouds.clear());

function sky() {
  const g = ctx.createLinearGradient(0, 0, 0, innerHeight);
  g.addColorStop(0, '#d9e3e7');
  g.addColorStop(0.45, '#c9d6d8');
  g.addColorStop(0.72, '#d8d2c2');
  g.addColorStop(1, '#8f8b67');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, innerWidth, innerHeight);

  const horizon = innerHeight * 0.72;
  ctx.fillStyle = 'rgba(80, 89, 54, 0.52)';
  ctx.fillRect(0, horizon, innerWidth, innerHeight - horizon);
  ctx.fillStyle = 'rgba(224, 214, 180, 0.18)';
  ctx.fillRect(0, horizon - 2, innerWidth, 4);
}

function contemplativeClouds(now) {
  if (clouds.size) return [];
  return contemplativeTexts.map((label, i) => ({
    id: `system-${i}`,
    text: label,
    x: ((now * 0.000006 * (i + 1)) + i * 0.21) % 1,
    y: 0.18 + i * 0.055,
    scale: 0.62 + i * 0.08,
    distance: 0.75,
    density: 0.32,
    drift: 0.01,
    opacity: 0.24,
    phase: i,
  }));
}

function drawShadow(cloud, sx, sy, radius) {
  const horizon = innerHeight * 0.72;
  const shadowY = horizon + (1 - cloud.y) * innerHeight * 0.18 + cloud.distance * 34;
  ctx.save();
  ctx.translate(sx + radius * 0.16, shadowY);
  ctx.scale(1.9, 0.28);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  g.addColorStop(0, `rgba(35, 39, 28, ${0.13 * (1 - cloud.distance) * cloud.opacity})`);
  g.addColorStop(1, 'rgba(35, 39, 28, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloud(cloud, now) {
  const depth = 1 - cloud.distance;
  const radius = (78 + cloud.text.length * 4) * cloud.scale * (0.42 + depth * 1.05);
  const sx = (cloud.x * innerWidth + now * cloud.drift * 18) % (innerWidth + radius * 2) - radius;
  const sy = cloud.y * innerHeight * 0.62 + 38;
  drawShadow(cloud, sx, sy, radius);

  const words = cloud.text.split(' ');
  const particles = Math.floor(18 + cloud.density * 85);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < particles; i += 1) {
    const angle = i * 2.399 + cloud.phase;
    const ring = Math.sqrt(i / particles);
    const wobble = Math.sin(now * 0.00025 + i + cloud.phase) * 8;
    const px = sx + Math.cos(angle) * ring * radius * 1.18 + wobble;
    const py = sy + Math.sin(angle) * ring * radius * 0.42;
    const size = (10 + Math.sin(i) * 3 + depth * 15) * cloud.scale;
    const alpha = cloud.opacity * (0.24 + depth * 0.56) * (0.55 + Math.random() * 0.15);
    ctx.font = `${Math.max(8, size)}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = `rgba(245, 247, 242, ${alpha})`;
    ctx.fillText(words[i % words.length], px, py);
  }
  ctx.restore();
}

function frame(now) {
  const dt = now - lastTime;
  lastTime = now;
  sky(dt);
  [...clouds.values(), ...contemplativeClouds(now)]
    .sort((a, b) => b.distance - a.distance)
    .forEach((cloud) => drawCloud(cloud, now / 1000));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
