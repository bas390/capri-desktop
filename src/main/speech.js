'use strict';

// Her speaking voice. Kokoro (the other project's English voice) says the line.
// Thai stays Thai in the bubble. The spoken words are the English meaning
// ("ใช่" is said as "yes"), from the local chat model, then Kokoro.
// If that model is quiet, an online voice reads the original line.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');
const kokoro = require('./kokoro');
const ollama = require('./ollama');

const MAX = 240;
const cache = new Map();

const SHOTS = [
  { role: 'system', content: 'Translate Thai into spoken English. Output only the English sentence. Do not add words that are not in the line. Keep letters that are already English, including slang.' },
  { role: 'user', content: 'ใช่' },
  { role: 'assistant', content: 'Yes' },
  { role: 'user', content: 'ไม่เป็นไร' },
  { role: 'assistant', content: 'It is fine' },
  { role: 'user', content: 'ว่าไง choom' },
  { role: 'assistant', content: 'Hey choom' },
  { role: 'user', content: 'เสร็จ! preem มาก' },
  { role: 'assistant', content: 'Done! So preem' },
];

function pickVoice(text) {
  if (/[\u0E00-\u0E7F]/.test(text)) return { voice: 'en-US-AvaMultilingualNeural', lang: 'th-TH' };
  if (/[\u0400-\u04FF]/.test(text)) return { voice: 'ru-RU-SvetlanaNeural', lang: 'ru-RU' };
  if (/[àâçéèêëîïôùûüœ]/i.test(text)) return { voice: 'fr-FR-DeniseNeural', lang: 'fr-FR' };
  if (/[áéíóúñ¿¡]/i.test(text)) return { voice: 'es-MX-DaliaNeural', lang: 'es-MX' };
  if (/[ãõç]/i.test(text)) return { voice: 'pt-BR-FranciscaNeural', lang: 'pt-BR' };
  return { voice: 'en-US-AriaNeural', lang: 'en-US' };
}

function chatModel() {
  const files = [];
  try {
    const { app } = require('electron');
    files.push(path.join(app.getPath('userData'), 'config.json'));
  } catch {
    // a bare node process has no app path
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    files.push(path.join(base, 'capri-desktop', 'config.json'));
  } else if (process.platform === 'darwin') {
    files.push(path.join(os.homedir(), 'Library', 'Application Support', 'capri-desktop', 'config.json'));
  } else {
    files.push(path.join(os.homedir(), '.config', 'capri-desktop', 'config.json'));
  }
  for (const file of files) {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg.provider === 'ollama' && cfg.chatModel) return cfg.chatModel;
    } catch {
      // try the next place the config might live
    }
  }
  return 'gemma3:4b';
}

function cleanEnglish(raw) {
  let line = String(raw || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  line = line.split('\n')[0].trim().replace(/^(english|translation)\s*:\s*/i, '');
  line = line.replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!line || /[\u0E00-\u0E7F]/.test(line)) return '';
  return line.slice(0, MAX);
}

async function translateThai(text) {
  if (cache.has(text)) return cache.get(text);
  try {
    const res = await fetch(`${ollama.base()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: chatModel(),
        stream: false,
        think: false,
        keep_alive: '15m',
        messages: [...SHOTS, { role: 'user', content: text }],
        options: { temperature: 0, num_predict: 80 },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return '';
    const body = await res.json();
    const english = cleanEnglish(body.message?.content);
    if (!english) return '';
    cache.set(text, english);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return english;
  } catch (err) {
    console.error('[capri] thai speech', err.message);
    return '';
  }
}

// mp3 or wav bytes, or null if the line is empty or nothing answered.
async function synthesize(text) {
  const spoken = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
  if (spoken.length < 2) return null;
  const thai = /[\u0E00-\u0E7F]/.test(spoken);
  const line = thai ? await translateThai(spoken) : spoken;
  if (line && /[A-Za-z]/.test(line)) {
    const local = await kokoro.speak(line);
    if (local) return local;
  }
  const { voice, lang } = pickVoice(spoken);
  const tts = new EdgeTTS({
    voice,
    lang,
    rate: '-20%',
    pitch: 'default',
    timeout: 12000,
  });
  const chunks = [];
  for await (const part of tts.streamAudio(spoken)) {
    if (Buffer.isBuffer(part)) chunks.push(part);
  }
  const audio = Buffer.concat(chunks);
  return audio.length > 200 ? audio : null;
}

module.exports = { synthesize };
