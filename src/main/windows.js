'use strict';

// Feeds the overlay with the position of the other windows, so Capri can sit on them.
// Windows: a PowerShell helper does the Win32 calls; its physical pixels become the overlay's
// coordinates. macOS: mac-windows.swift reports points in the same space as her window.
// It also says when the window in front is another AI (ChatGPT,
// Gemini…: `ai`, the names it matched), for her jealousy, and never passes on a title; which game
// is in front, if one (`game`, its folder in Steam's library or another launcher's); and the USB
// sticks plugged in (`usb`, drive letters), and the last device plugged in or out (`plug`).

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { screen } = require('electron');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const MAC_SCRIPT = path.join(__dirname, 'mac-windows.swift');

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform === 'darwin') return startMacWatch({ overlay, onUpdate });
  if (process.platform !== 'win32') return { stop() {}, refresh() {} };

  let child = null;
  let stopped = false;
  let restarts = 0;
  let last = null; // the helper's last snapshot: it only speaks when something changes

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    // macOS already reports points; Windows reports physical pixels
    const dip = win.dip
      ? { x: win.x, y: win.y, width: win.w, height: win.h }
      : screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  // the snapshot as seen from her window, wherever it is now
  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => toOverlay({ ...w, dip: Boolean(last.dip) }, bounds))
      // only what overlaps Capri's screen
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    onUpdate({
      fg: last.fg, taskbar: Boolean(last.taskbar), ai: Array.isArray(last.ai) ? last.ai : [],
      game: last.game || null, usb: Array.isArray(last.usb) ? last.usb : [], plug: last.plug || null, wins,
    });
  };

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        last = JSON.parse(line);
      } catch {
        return;
      }
      send();
    });
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    // her window moved (another screen, the taskbar in it or not): the same windows, from there
    refresh: send,
  };
}

// Same snapshots as the PowerShell helper. Swift is on a Mac with Xcode or its command line tools;
// without it she still floats, she just can't sit on windows.
function startMacWatch({ overlay, onUpdate }) {
  if (!fs.existsSync('/usr/bin/swift')) {
    console.error('[capri] window watch: swift is not installed, she will not sit on windows');
    return { stop() {}, refresh() {} };
  }

  let child = null;
  let stopped = false;
  let restarts = 0;
  let last = null;

  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => ({ id: w.id, x: w.x - bounds.x, y: w.y - bounds.y, w: w.w, h: w.h, max: w.max }))
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    onUpdate({
      fg: last.fg, taskbar: false, ai: Array.isArray(last.ai) ? last.ai : [],
      game: last.game || null, usb: [], plug: null, wins,
    });
  };

  const start = () => {
    child = spawn('/usr/bin/swift', [MAC_SCRIPT, String(process.pid)], { stdio: ['ignore', 'pipe', 'pipe'] });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        last = JSON.parse(line);
      } catch {
        return;
      }
      send();
    });
    child.stderr.on('data', (d) => {
      const line = String(d).trim();
      if (/error:/i.test(line)) console.error('[capri] window watch:', line);
    });
    child.on('exit', () => {
      child = null;
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    refresh: send,
  };
}

module.exports = { startWindowWatch };
