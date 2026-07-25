/**
 * Lightweight global keyboard activity probe (Win + macOS).
 * Uses system FFI via koffi — no Accessibility permission on Mac for key-state poll.
 */
const IDLE_MS = 1200;
const POLL_MS = 120;

let timer = null;
let lastKeyAt = 0;
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
      // VK range excluding mouse buttons 1–6
      const keys = [];
      for (let vk = 0x08; vk <= 0xfe; vk++) {
        if (vk >= 1 && vk <= 6) continue;
        keys.push(vk);
      }
      probe = {
        anyKeyDown() {
          for (let i = 0; i < keys.length; i++) {
            if (GetAsyncKeyState(keys[i]) & 0x8000) return true;
          }
          return false;
        },
      };
      return probe;
    }
    if (process.platform === 'darwin') {
      const as = koffi.load(
        '/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices'
      );
      // kCGEventSourceStateCombinedSessionState = 0
      const CGEventSourceKeyState = as.func(
        'bool CGEventSourceKeyState(int stateID, ushort key)'
      );
      const codes = [];
      for (let c = 0; c <= 127; c++) codes.push(c);
      probe = {
        anyKeyDown() {
          for (let i = 0; i < codes.length; i++) {
            if (CGEventSourceKeyState(0, codes[i])) return true;
          }
          return false;
        },
      };
      return probe;
    }
  } catch (err) {
    console.warn('[keyboard-activity] probe unavailable', err?.message || err);
  }
  probe = {
    anyKeyDown() {
      return false;
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
  let down = false;
  try {
    down = !!p.anyKeyDown();
  } catch (_) {
    down = false;
  }
  const now = Date.now();
  if (down) {
    lastKeyAt = now;
    emit(true);
  } else if (typing && now - lastKeyAt >= IDLE_MS) {
    emit(false);
  }
}

function start(callback) {
  onChange = typeof callback === 'function' ? callback : null;
  if (timer) return;
  loadProbe();
  lastKeyAt = 0;
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
