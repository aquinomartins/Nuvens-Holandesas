(function () {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const sanitizeText = (text) => String(text || '')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  const createSocket = () => io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 600 });

  window.Nuvens = { clamp, sanitizeText, createSocket };
}());
