'use strict';

// npm on a Mac skips the Windows voice library. The Windows installer is built
// here, so pull that library into node_modules before electron-builder packs it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PACKS = [
  {
    name: 'sherpa-onnx-win-x64',
    url: 'https://registry.npmjs.org/sherpa-onnx-win-x64/-/sherpa-onnx-win-x64-2.0.1.tgz',
    integrity: 'sha512-7vwdAw9PGEb0JLSpK7UFxAdp1vabBHK9Nhw2jFRBWSFgtslUPHIB0T6syJfRgiUGyCeNW9fJvcFAk2F2u7hBEw==',
  },
  {
    name: 'sherpa-onnx-win-arm64',
    url: 'https://registry.npmjs.org/sherpa-onnx-win-arm64/-/sherpa-onnx-win-arm64-2.0.1.tgz',
    integrity: 'sha512-Mb9iqy2Zp7GC5a99dk5E8EQJsEBnapf+IcwHLVCgtIf5mxYHO9Q8YptnAoOHZOD0Zi+R+MblFyG9qv0Q6tin4Q==',
  },
];

function sha512(file) {
  const hash = crypto.createHash('sha512');
  hash.update(fs.readFileSync(file));
  return `sha512-${hash.digest('base64')}`;
}

async function fetchPack(pack) {
  const dest = path.join(ROOT, 'node_modules', pack.name);
  if (fs.existsSync(path.join(dest, 'sherpa-onnx.node'))) {
    console.log(`[capri] ${pack.name} already present`);
    return;
  }
  const tmp = path.join(ROOT, 'node_modules', `.${pack.name}.tgz`);
  console.log(`[capri] downloading ${pack.name}`);
  const res = await fetch(pack.url);
  if (!res.ok) throw new Error(`${pack.name}: ${res.status}`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  if (sha512(tmp) !== pack.integrity) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${pack.name}: checksum did not match`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const extracted = spawnSync('tar', ['-xzf', tmp, '-C', dest, '--strip-components=1'], { stdio: 'inherit' });
  fs.rmSync(tmp, { force: true });
  if (extracted.status !== 0) throw new Error(`${pack.name}: extract failed`);
  console.log(`[capri] ${pack.name} ready`);
}

Promise.all(PACKS.map(fetchPack)).catch((err) => {
  console.error('[capri]', err.message);
  process.exit(1);
});
