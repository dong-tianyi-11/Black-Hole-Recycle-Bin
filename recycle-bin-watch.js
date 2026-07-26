/**
 * Poll OS Recycle Bin item count. When it drops to 0 after having items,
 * emit onEmpty so the desk pet can shrink back.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const INTERVAL_MS = 2500;

async function queryRecycleCount() {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          '(New-Object -ComObject Shell.Application).NameSpace(0x0a).Items().Count',
        ],
        { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024 }
      );
      const n = parseInt(String(stdout || '').trim(), 10);
      return Number.isFinite(n) ? n : -1;
    } catch (_) {
      return -1;
    }
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-e', 'tell application "Finder" to get count of items in trash'],
        { timeout: 8000, maxBuffer: 1024 * 1024 }
      );
      const n = parseInt(String(stdout || '').trim(), 10);
      return Number.isFinite(n) ? n : -1;
    } catch (_) {
      return -1;
    }
  }
  return -1;
}

function createRecycleBinWatcher({ onEmpty, onCount } = {}) {
  let timer = null;
  let lastCount = -1;
  let seenNonEmpty = false;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const n = await queryRecycleCount();
      if (n < 0) return;
      if (typeof onCount === 'function') onCount(n);
      if (n > 0) seenNonEmpty = true;
      if (seenNonEmpty && n === 0 && lastCount !== 0) {
        seenNonEmpty = false;
        if (typeof onEmpty === 'function') onEmpty();
      }
      lastCount = n;
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (timer) return;
      tick();
      timer = setInterval(tick, INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async refresh() {
      await tick();
    },
    markFed() {
      seenNonEmpty = true;
    },
  };
}

module.exports = { createRecycleBinWatcher, queryRecycleCount };
