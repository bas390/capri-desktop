// Frame strips drawn by Lachy (see assets/capri/strips/NOTICE.txt). Each file is one
// horizontal row of cells. count and fps match the clip list in that project.
// scale is how tall the cell is drawn next to this body's usual height.
// anchor 'feet' sits the bottom of the cell on her feet. 'seat' is Lachy's SitY:
// that fraction of the cell sits exactly on the window's top edge, and the legs
// below it hang inside.

const DIR = '../../assets/capri/strips/';

export const STRIPS = {
  idle: { count: 16, fps: 8, scale: 1.11, anchor: 'feet' },
  mouth: { count: 5, fps: 12, scale: 1.11, anchor: 'feet' },
  walk: { count: 12, fps: 12, scale: 1.11, anchor: 'feet' },
  dance: { count: 16, fps: 12, scale: 1.11, anchor: 'feet' },
  dangle: { count: 24, fps: 10, scale: 1.11, anchor: 'feet' },
  sleep: { count: 16, fps: 6, scale: 1.11, anchor: 'feet' },
  wake: { count: 13, fps: 15, scale: 1.11, anchor: 'feet' },
  glitch: { count: 10, fps: 15, scale: 1.11, anchor: 'feet' },
  grin: { count: 16, fps: 8, scale: 1.11, anchor: 'feet' },
  arrive: { count: 14, fps: 15, scale: 1.11, anchor: 'feet' },
  leave: { count: 12, fps: 15, scale: 1.11, anchor: 'feet' },
  perch: { count: 16, fps: 8, scale: 1, anchor: 'seat', seat: 0.79 },
  perch_blink: { count: 4, fps: 8, scale: 1, anchor: 'seat', seat: 0.79 },
  perch_blink_glitch: { count: 4, fps: 8, scale: 1, anchor: 'seat', seat: 0.79 },
  perch_glitch: { count: 10, fps: 15, scale: 1, anchor: 'seat', seat: 0.79 },
  perch_dance: { count: 16, fps: 12, scale: 1, anchor: 'seat', seat: 0.79 },
  perch_arrive: { count: 14, fps: 15, scale: 1, anchor: 'seat', seat: 0.79 },
  perch_leave: { count: 12, fps: 15, scale: 1, anchor: 'seat', seat: 0.79 },
};

// Which of the five mouth drawings, the same picks as that project's MouthFor.
// A vowel opens, m/b/p and spaces close, anything else flaps. Thai letters flap.
export function mouthCell(text, now, start) {
  const step = Math.floor((now - (start || now)) / (1000 / 12));
  const chars = [...String(text || '')];
  const flap = step % 2 === 1 ? 1 : 2;
  if (!chars.length) return flap;
  const letter = Math.floor(step / 12 * 28);
  if (letter < 0 || letter >= chars.length) return flap;
  const ch = chars[letter];
  const lower = ch.toLowerCase();
  if ('aeo'.includes(lower)) return ch === lower ? 3 : 4;
  if ('iuy'.includes(lower)) return 2;
  if ('mbp'.includes(lower) || !/\p{L}/u.test(ch)) return 0;
  return flap;
}

// Cut a strip into one canvas per frame, so drawing never samples the wide sheet.
function sliceStrip(img, count) {
  const cellW = img.width / count;
  const cellH = img.height;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const cel = document.createElement('canvas');
    cel.width = cellW;
    cel.height = cellH;
    cel.getContext('2d').drawImage(img, i * cellW, 0, cellW, cellH, 0, 0, cellW, cellH);
    frames.push(cel);
  }
  return { width: img.width, height: img.height, cellW, cellH, frames };
}

export function loadStrips() {
  return Promise.all(Object.keys(STRIPS).map((name) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve([name, img]);
    img.onerror = () => resolve([name, null]);
    img.src = `${DIR}${name}.png`;
  }))).then((pairs) => {
    const out = {};
    for (const [name, img] of pairs) {
      if (!img) continue;
      // The talking body is the one that pops in on a line. Slice it now so that
      // moment is a small blit, not a decode of the full sheet.
      // Every clip is cut into cells up front. Sampling the wide sheet each
      // frame stalled this Mac and the clock skipped to the end of the gif.
      out[name] = sliceStrip(img, STRIPS[name].count);
    }
    return out;
  });
}
