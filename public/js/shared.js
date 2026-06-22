(function () {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));
  const sanitizeText = (text) => String(text || '')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

  const createSocket = () => io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
    timeout: 10000,
    transports: ['websocket', 'polling'],
  });


  const ASSET_VERSION = '20260622';
  const withAssetVersion = (src) => `${src}${src.includes('?') ? '&' : '?'}v=${ASSET_VERSION}`;
  const characterAsset = (filename) => withAssetVersion(`/assets/characters/${filename}`);
  const logImageLoad = (label, src) => console.info(`[nuvens:image] carregando ${label}: ${src}`);
  const logImageReady = (label, src) => console.info(`[nuvens:image] carregada ${label}: ${src}`);
  const logImageError = (label, src) => console.warn(`[nuvens:image] não encontrada ${label}: ${src}`);

  window.Nuvens = {
    clamp,
    sanitizeText,
    createSocket,
    ASSET_VERSION,
    withAssetVersion,
    characterAsset,
    logImageLoad,
    logImageReady,
    logImageError,
  };
}());
