const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const filesToScan = ['public/js/participant.js', 'public/js/exhibition.js', 'public/participar.html'];
const assetRegexes = [
  /['"`]((?:\/assets\/|assets\/)[^'"`?]+)(?:\?[^'"`]*)?['"`]/g,
  /characterAsset\(['"`]([^'"`]+)['"`]\)/g,
];
let failed = false;

function fail(message) {
  failed = true;
  console.error(`[verify-assets] ${message}`);
}

for (const relativeFile of filesToScan) {
  const absoluteFile = path.join(root, relativeFile);
  const content = fs.readFileSync(absoluteFile, 'utf8');
  for (const regex of assetRegexes) {
    for (const match of content.matchAll(regex)) {
      const rawPath = regex.source.startsWith('characterAsset') ? `/assets/characters/${match[1]}` : match[1];
      const urlPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      const diskPath = path.join(publicDir, urlPath);
      if (!diskPath.startsWith(publicDir + path.sep)) {
        fail(`${relativeFile}: caminho fora de public/: ${urlPath}`);
        continue;
      }
      if (!fs.existsSync(diskPath)) {
        fail(`${relativeFile}: asset inexistente ou com caixa/extensão diferente no Linux: ${urlPath}`);
      } else {
        console.log(`[verify-assets] OK ${relativeFile} -> ${urlPath}`);
      }
    }
  }
}

if (failed) process.exit(1);
