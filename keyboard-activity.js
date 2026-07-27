/**
 * Global keyboard activity probe (Win + macOS) via koffi.
 *
 * Only real typing keys count. Scanning all VKs is unsafe — some OEM / driver
 * codes stay "down" forever (seen: VK 0x85), which froze pets on 敲键盘 / 炼丹.
 *
 * Rules:
 * - Enter typing only on a key-down edge (LSB / newly pressed)
 * - Holding Backspace/Delete/letters may extend typing briefly after an edge
 * - Modifiers / mystery OEM keys are ignored
 */
const IDLE_MS = 600;
const POLL_MS = 80;
/** After last real edge, allow held keys to keep "typing" this long (ms). */
const HOLD_EXTEND_MS = 1800;

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** Windows VK whitelist — characters, nav, edit. No modifiers / OEM junk. */
const WIN_TYPING_KEYS = [
  0x08, // Backspace
  0x09, // Tab
  0x0d, // Enter
  0x20, // Space
  0x21, // Page Up
  0x22, // Page Down
  0x23, // End
  0x24, // Home
  0x25, // Left
  0x26, // Up
  0x27, // Right
  0x28, // Down
  0x2e, // Delete
  ...range(0x30, 0x39), // 0-9
  ...range(0x41, 0x5a), // A-Z
  ...range(0x60, 0x69), // numpad 0-9
  0x6a, 0x6b, 0x6d, 0x6e, 0x6f, // numpad * + - . /
  // Common punctuation (US / CN IME still maps these while composing)
  0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xc0, // ;=,-./`
  0xdb, 0xdc, 0xdd, 0xde, // [\]'
];

/** Keys whose held state may extend typing (after a real edge). */
const WIN_HOLDABLE = new Set([
  0x08, 0x2e, 0x20,
  ...range(0x30, 0x39),
  ...range(0x41, 0x5a),
  ...range(0x60, 0x69),
]);

/** macOS keycodes — letters/digits/nav; skip modifiers. */
const MAC_TYPING_KEYS = [
  ...range(0, 50), // letters, numbers, punctuation block (excludes most modifiers)
  51, // delete
  36, // return
  48, // tab
  49, // space
  123, 124, 125, 126, // arrows
  115, 116, 119, 121, // home / page / end
];
const MAC_MODIFIERS = new Set([54, 55, 56, 58, 59, 60, 61, 62, 63]);

let timer = null;
let lastKeyAt = 0;
let lastEdgeAt = 0;
let typing = false;
let onChange = null;
let probe = null;

function loadProbe() {
  if (probe) return probe;
  try {
    const koffi = require('koffi');
    if (process.platform === 'win32') {
      const user32 = koffi.load('user32.dll');
      const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
      const keys = WIN_TYPING_KEYS;
      probe = {
        sample() {
          let edge = false;
          let hold = false;
          for (let i = 0; i < keys.length; i++) {
            const vk = keys[i];
            const s = GetAsyncKeyState(vk);
            if (s & 0x0001) edge = true;
            if ((s & 0x8000) && WIN_HOLDABLE.has(vk)) hold = true;
          }
          return { edge, hold };
        },
      };
      return probe;
    }
    if (process.platform === 'darwin') {
      const as = koffi.load(
        '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
      );
      const CGEventSourceKeyState = as.func(
        'bool CGEventSourceKeyState(int stateID, ushort key)'
      );
      const codes = MAC_TYPING_KEYS.filter((c) => !MAC_MODIFIERS.has(c));
      let prev = new Uint8Array(128);
      probe = {
        sample() {
          let edge = false;
          let hold = false;
          for (let i = 0; i < codes.length; i++) {
            const c = codes[i];
            const down = !!CGEventSourceKeyState(0, c);
            if (down && !prev[c]) edge = true;
            if (down) hold = true;
            prev[c] = down ? 1 : 0;
          }
          return { edge, hold };
        },
      };
      return probe;
    }
  } catch (err) {
    console.warn('[keyboard-activity] probe unavailable', err?.message || err);
  }
  probe = {
    sample() {
      return { edge: false, hold: false };
    },
  };
  return probe;
}

function emit(next) {
  if (typing === next) return;
  typing = next;
  try {
    onChange?.(typing);
  } catch (_) {}
}

function tick() {
  const p = loadProbe();
  let edge = false;
  let hold = false;
  try {
    const s = p.sample ? p.sample() : { edge: !!p.anyKeyActivity?.(), hold: false };
    edge = !!s.edge;
    hold = !!s.hold;
  } catch (_) {
    edge = false;
    hold = false;
  }
  const now = Date.now();

  if (edge) {
    // Only a real key press starts / refreshes typing
    lastKeyAt = now;
    lastEdgeAt = now;
    emit(true);
    return;
  }

  if (typing && hold && now - lastEdgeAt < HOLD_EXTEND_MS) {
    // Holding Backspace etc. after a real press — keep face briefly
    lastKeyAt = now;
    return;
  }

  if (typing && now - lastKeyAt >= IDLE_MS) {
    emit(false);
  }
}

function start(callback) {
  onChange = typeof callback === 'function' ? callback : null;
  if (timer) return;
  probe = null;
  loadProbe();
  lastKeyAt = 0;
  lastEdgeAt = 0;
  typing = false;
  timer = setInterval(tick, POLL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const was = typing;
  typing = false;
  lastKeyAt = 0;
  lastEdgeAt = 0;
  if (was) {
    try {
      onChange?.(false);
    } catch (_) {}
  }
  onChange = null;
}

function isTyping() {
  return typing;
}

module.exports = { start, stop, isTyping };
