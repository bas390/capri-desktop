'use strict';

// Keeps one Kokoro process alive. Loading the model takes a few seconds, so it
// stays up between lines. The lexicon is English. A Thai line is translated
// to English before it gets here.
//
// The native library is the sherpa-onnx build for this OS. Electron cannot
// load it (the Mac build strips DYLD_*, and the addon is built for Node), so a
// system `node` process does the speaking on Mac and on Windows.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function unpacked(file) {
  return file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

function userData() {
  try {
    const { app } = require('electron');
    if (app?.getPath) return app.getPath('userData');
  } catch {
    // a bare node process has no app path
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'capri-desktop');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'capri-desktop');
  return path.join(os.homedir(), '.config', 'capri-desktop');
}

function nativePackage() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64';
  if (process.platform === 'win32') return `sherpa-onnx-win-${arch}`;
  if (process.platform === 'darwin') return `sherpa-onnx-darwin-${arch}`;
  if (process.platform === 'linux') return `sherpa-onnx-linux-${arch}`;
  return '';
}

const MODEL = path.join(userData(), 'voice', 'capri-voice-1');
const LIB = nativePackage() ? unpacked(path.join(ROOT, 'node_modules', nativePackage())) : '';

let child = null;
let ready = null;
let seq = 0;
const pending = new Map();
let stdout = '';

function modelReady() {
  return Boolean(LIB)
    && fs.existsSync(path.join(MODEL, 'model.onnx'))
    && fs.existsSync(path.join(MODEL, 'voices.bin'))
    && fs.existsSync(path.join(LIB, 'sherpa-onnx.node'));
}

function childEnv() {
  const env = { ...process.env };
  if (!LIB) return env;
  if (process.platform === 'win32') env.PATH = `${LIB}${path.delimiter}${env.PATH || ''}`;
  else if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = `${LIB}${path.delimiter}${env.DYLD_LIBRARY_PATH || ''}`;
  else env.LD_LIBRARY_PATH = `${LIB}${path.delimiter}${env.LD_LIBRARY_PATH || ''}`;
  return env;
}

function start() {
  if (child || !modelReady()) return;
  child = spawn(process.env.KOKORO_NODE || 'node', [unpacked(path.join(__dirname, 'kokoro-worker.js')), MODEL], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let nl;
    while ((nl = stdout.indexOf('\n')) !== -1) {
      const line = stdout.slice(0, nl).trim();
      stdout = stdout.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.ready) {
        ready = true;
        continue;
      }
      const wait = pending.get(msg.id);
      if (!wait) continue;
      pending.delete(msg.id);
      if (msg.wav) wait.resolve(Buffer.from(msg.wav, 'base64'));
      else wait.resolve(null);
    }
  });
  child.on('exit', () => {
    child = null;
    ready = false;
    for (const wait of pending.values()) wait.resolve(null);
    pending.clear();
  });
}

function speak(text) {
  if (!modelReady()) return Promise.resolve(null);
  start();
  if (!child) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 20000);
    pending.set(id, {
      resolve: (buf) => {
        clearTimeout(timer);
        resolve(buf && buf.length > 200 ? buf : null);
      },
    });
    child.stdin.write(JSON.stringify({ id, text }) + '\n');
  });
}

module.exports = { speak, modelReady };
