'use strict';

// Keeps one Kokoro process alive. Loading the model takes a few seconds, so it
// stays up between lines. The lexicon is English. A Thai line is translated
// to English before it gets here.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MODEL = path.join(
  process.env.HOME || '',
  'Library/Application Support/capri-desktop/voice/capri-voice-1',
);
const LIB = path.join(ROOT, 'node_modules/sherpa-onnx-darwin-arm64');

let child = null;
let ready = null;
let seq = 0;
const pending = new Map();
let stdout = '';

function modelReady() {
  return fs.existsSync(path.join(MODEL, 'model.onnx'))
    && fs.existsSync(path.join(MODEL, 'voices.bin'))
    && fs.existsSync(path.join(LIB, 'sherpa-onnx.node'));
}

function start() {
  if (child || !modelReady()) return;
  child = spawn(process.env.KOKORO_NODE || 'node', [path.join(__dirname, 'kokoro-worker.js'), MODEL], {
    cwd: ROOT,
    env: {
      ...process.env,
      DYLD_LIBRARY_PATH: `${LIB}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ''}`,
    },
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
