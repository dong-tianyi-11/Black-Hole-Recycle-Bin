/**
 * Detect system media playback.
 * Windows: GSMTC (all sessions) + fast process window-title fallback for
 * 网易云 / QQ音乐 / Spotify 等 (WinRT probe often fails in packaged apps).
 * macOS: AppleScript player state best-effort.
 */
const { execFile } = require('child_process');
const path = require('path');

const POLL_MS = 1200;
const IDLE_HOLD_MS = 2500;
const GSMTC_EVERY_N = 3; // title probe every tick; GSMTC every N ticks

let timer = null;
let playing = false;
let lastPlayingAt = 0;
let onChange = null;
let probing = false;
let tickN = 0;
let winProbe = null;

function emit(next) {
  if (playing === next) return;
  playing = next;
  try {
    onChange?.(playing);
  } catch (_) {}
}

/** Known players: non-idle main-window title ⇒ likely playing/paused-with-track. */
const MUSIC_PROCS = [
  {
    exe: 'cloudmusic.exe',
    idle: [/^$/, /^网易云音乐$/, /^cloudmusic$/i, /^netease/i],
  },
  {
    exe: 'lyraapp.exe', // newer NetEase shell
    idle: [/^$/, /^网易云音乐$/, /^lyra$/i],
  },
  {
    exe: 'qqmusic.exe',
    idle: [/^$/, /^qq音乐$/, /^qqmusic$/i],
  },
  {
    exe: 'spotify.exe',
    idle: [/^$/, /^spotify$/i, /^spotify premium$/i, /^spotify free$/i],
  },
  {
    exe: 'kugou.exe',
    idle: [/^$/, /^酷狗音乐$/, /^kugou$/i],
  },
  {
    exe: 'kwmusic.exe',
    idle: [/^$/, /^酷我音乐$/, /^kwmusic$/i],
  },
  {
    exe: 'music.exe', // Apple Music / some skins — weak signal
    idle: [/^$/, /^music$/i, /^Groove Music$/i],
  },
];

function isIdleTitle(title, idleRules) {
  const t = String(title || '').trim();
  for (const rule of idleRules) {
    if (rule.test(t)) return true;
  }
  return false;
}

function loadWinProbe() {
  if (winProbe) return winProbe;
  if (process.platform !== 'win32') {
    winProbe = { scanTitles: () => false };
    return winProbe;
  }
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    const MAX = 512;
    const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');
    const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
    const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hwnd)');
    const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void *hwnd, uint16 *buf, int max)');
    const GetWindowThreadProcessId = user32.func(
      'uint32 __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'
    );
    const OpenProcess = kernel32.func('void * __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
    const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void *h)');
    const QueryFullProcessImageNameW = kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(void *h, uint32 flags, uint16 *buf, _Inout_ uint32 *size)'
    );

    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const titleBuf = Buffer.alloc(MAX * 2);
    const pathBuf = Buffer.alloc(MAX * 2);
    const titleU16 = koffi.as(titleBuf, 'uint16 *');
    const pathU16 = koffi.as(pathBuf, 'uint16 *');

    function readWString(buf, chars) {
      if (chars <= 0) return '';
      return buf.toString('utf16le', 0, Math.min(chars, MAX - 1) * 2).replace(/\0+$/, '');
    }

    function exeBaseFromPid(pid) {
      const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
      if (!h || h === 0 || h === null) return '';
      try {
        pathBuf.fill(0);
        const sizeArr = [MAX];
        const ok = QueryFullProcessImageNameW(h, 0, pathU16, sizeArr);
        if (!ok) return '';
        const full = readWString(pathBuf, sizeArr[0] || MAX);
        return path.basename(full).toLowerCase();
      } finally {
        CloseHandle(h);
      }
    }

    winProbe = {
      scanTitles() {
        const wanted = new Map(MUSIC_PROCS.map((p) => [p.exe.toLowerCase(), p]));
        let hit = false;
        const cb = koffi.register((hwnd /*, lParam */) => {
          if (hit) return true;
          if (!IsWindowVisible(hwnd)) return true;
          const pidOut = [0];
          GetWindowThreadProcessId(hwnd, pidOut);
          const pid = pidOut[0] >>> 0;
          if (!pid) return true;
          const exe = exeBaseFromPid(pid);
          const rule = wanted.get(exe);
          if (!rule) return true;
          titleBuf.fill(0);
          const n = GetWindowTextW(hwnd, titleU16, MAX);
          const title = readWString(titleBuf, n);
          if (!isIdleTitle(title, rule.idle)) {
            hit = true;
          }
          return true;
        }, koffi.pointer(EnumWindowsProc));
        try {
          EnumWindows(cb, 0);
        } finally {
          koffi.unregister(cb);
        }
        return hit;
      },
    };
    return winProbe;
  } catch (err) {
    console.warn('[media] win title probe unavailable', err?.message || err);
    winProbe = { scanTitles: () => false };
    return winProbe;
  }
}

const PS_GSMTC = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue | Out-Null
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$sw = [Diagnostics.Stopwatch]::StartNew()
while ([int]$op.Status -eq 0 -and $sw.ElapsedMilliseconds -lt 2500) { Start-Sleep -Milliseconds 30 }
if ([int]$op.Status -ne 1) { Write-Output 'None'; exit 0 }
$mgr = $op.GetResults()
foreach ($s in $mgr.GetSessions()) {
  $st = [int]$s.GetPlaybackInfo().PlaybackStatus
  # Playing = 4
  if ($st -eq 4) { Write-Output 'Playing'; exit 0 }
}
Write-Output 'None'
`;

function runPsGsmtc() {
  return new Promise((resolve) => {
    const ps =
      process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
    execFile(
      ps,
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', PS_GSMTC],
      { timeout: 3500, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null); // unknown — don't treat as false
          return;
        }
        const s = String(stdout || '')
          .trim()
          .split(/\r?\n/)
          .pop();
        if (s === 'Playing') resolve(true);
        else if (s === 'None') resolve(false);
        else resolve(null);
      }
    );
  });
}

async function runMacProbe() {
  return new Promise((resolve) => {
    const script = `
      set playing to false
      try
        if application "Music" is running then
          tell application "Music" to if player state is playing then set playing to true
        end if
      end try
      try
        if application "Spotify" is running then
          tell application "Spotify" to if player state is playing then set playing to true
        end if
      end try
      if playing then return "Playing"
      return "None"
    `;
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(String(stdout || '').trim() === 'Playing');
    });
  });
}

async function probeOnce() {
  if (process.platform === 'darwin') return runMacProbe();
  if (process.platform !== 'win32') return false;

  // Fast path: 网易云 / QQ音乐 window titles (works when GSMTC is broken)
  const byTitle = !!loadWinProbe().scanTitles();
  if (byTitle) return true;

  // Occasional GSMTC for browsers / Store apps / players that only expose SMTC
  tickN += 1;
  if (tickN % GSMTC_EVERY_N === 0) {
    const gs = await runPsGsmtc();
    if (gs === true) return true;
  }
  return false;
}

async function tick() {
  if (probing) return;
  probing = true;
  try {
    const on = await probeOnce();
    const now = Date.now();
    if (on) {
      lastPlayingAt = now;
      emit(true);
      // Keep pushing while playing so renderer can recover from missed IPC
      try {
        onChange?.(true);
      } catch (_) {}
    } else if (now - lastPlayingAt >= IDLE_HOLD_MS) {
      emit(false);
    }
  } catch (_) {
    /* ignore */
  } finally {
    probing = false;
  }
}

function start(cb) {
  onChange = typeof cb === 'function' ? cb : null;
  if (!timer) {
    lastPlayingAt = 0;
    playing = false;
    tickN = 0;
    timer = setInterval(tick, POLL_MS);
    if (timer.unref) timer.unref();
  }
  // Always probe + sync current state (fixes "already playing before window ready")
  tick();
  try {
    onChange?.(playing);
  } catch (_) {}
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  onChange = null;
  playing = false;
}

function isPlaying() {
  return playing;
}

/** Force-notify listener of current state (theme/window ready catch-up). */
function notify() {
  try {
    onChange?.(playing);
  } catch (_) {}
}

module.exports = { start, stop, isPlaying, notify };
