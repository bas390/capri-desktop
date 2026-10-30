'use strict';

// Speaks with the Kokoro model from lachydotmcg/capri-desktop. The native
// sherpa-onnx library is chosen by kokoro.js for Mac or Windows.
// One JSON object per line in, one JSON object per line out.

const path = require('path');
const sherpa = require('sherpa-onnx-node');

const dir = process.argv[2];
const SID = 53; // "Her own" in that project's voice list
const SPEED = 1.1;

const tts = new sherpa.OfflineTts({
  model: {
    kokoro: {
      model: path.join(dir, 'model.onnx'),
      voices: path.join(dir, 'voices.bin'),
      tokens: path.join(dir, 'tokens.txt'),
      lexicon: path.join(dir, 'lexicon-us-en.txt'),
    },
    numThreads: 1,
    provider: 'cpu',
    debug: false,
  },
  maxNumSentences: 1,
});

function wavBytes(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

process.stdout.write(JSON.stringify({ ready: true, speakers: tts.numSpeakers }) + '\n');

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      const cfg = new sherpa.GenerationConfig({ sid: SID, speed: SPEED, silenceScale: 0.2 });
      const audio = tts.generate({ text: String(msg.text || ''), generationConfig: cfg });
      const wav = wavBytes(audio.samples, audio.sampleRate);
      process.stdout.write(JSON.stringify({ id: msg.id, wav: wav.toString('base64') }) + '\n');
    } catch (err) {
      process.stdout.write(JSON.stringify({ id: msg.id, error: String(err && err.message || err) }) + '\n');
    }
  }
});
