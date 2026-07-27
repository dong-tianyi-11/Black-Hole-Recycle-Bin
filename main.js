const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { recyclePaths } = require('./recycle');
const {
  refreshDesktopPlate,
  refreshPlateLive,
  cropPlateForWindow,
  hasPlate,
} = require('./capture');
const themeLoader = require('./theme-loader');
const themeImporter = require('./theme-importer');
const { createThemeFromImage, testAiConnection, preflightAi, assessEndpoint, DEFAULT_BASE, DEFAULT_MODEL, PROVIDER_PRESETS, normalizeBaseUrl, detectVisionSupport } = require('./theme-from-image');
const {
  getDisplaysSafe,
  clampToDisplays,
  centerOnWorkArea,
  findDisplayById,
  displaySnapshot,
  primaryWorkArea,
} = require('./screen-clamp');
const { createUpdater } = require('./updater');
const { createMiniController } = require('./mini');
const aiSecrets = require('./ai-secrets');
const keyboardActivity = require('./keyboard-activity');
const mediaActivity = require('./media-activity');
const { createRecycleBinWatcher } = require('./recycle-bin-watch');

app.setPath('userData', path.join(app.getPath('appData'), 'black-hole-recycle-bin'));

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  size: 360,
  // baseSize is set on first ensureBaseSize() so existing installs
  // don't treat a large size as "fed growth"
  x: null,
  y: null,
  alwaysOnTop: true,
  theme: 'blackhole',
  openAtLogin: false,
  doNotDisturb: false,
  lowPowerIdle: true,
  clickThrough: true,
  // When true: window appears in EV/OBS/etc. When false + blackhole:
  // exclude from capture so desktop warp can refresh without self-image.
  allowScreenCapture: false,
  themePositions: {},
  autoUpdateCheck: true,
  miniMode: false,
  miniEdge: 'right',
  preMiniX: 0,
  preMiniY: 0,
  lastLaunchedVersion: '',
  // API Key is stored encrypted in userData/ai-secrets.json (not here)
  aiBaseUrl: 'https://api.deepseek.com/v1',
  aiModel: 'deepseek-chat',
};

let mainWindow = null;
let tray = null;
let cropTimer = null;
let moveCropTimer = null;
let fullPlateTimer = null;
let capturePaused = false;
let lastCropKey = '';
let isMoving = false;
let userDragging = false;
let userResizing = false;
let dragLockSize = null; // { width, height } frozen for the whole drag
let dragGrabOffset = null; // cursor - window origin at drag start (DIP)
let dragFollowTimer = null; // main-process follow loop (avoids IPC/pointer lag)
let allowPulseResize = false;
let lastActiveAt = Date.now();
let mousePassthrough = true;

let updater = null;
let mini = null;
let aiSettingsWin = null;
let sizeSettingsWin = null;
let recycleBinWatcher = null;
let sizeAnimTimer = null;

const GROW_PER_ITEM = 40;
const SIZE_MIN = 160;
const SIZE_MAX = 720;

function getUpdater() {
  if (!updater) {
    updater = createUpdater({
      getConfig: loadConfig,
      saveConfig,
      rebuildMenus: () => rebuildTrayMenu(),
      getParentWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
      setTrayTooltip: (text) => {
        if (tray) tray.setToolTip(String(text || '黑洞回收站'));
      },
    });
  }
  return updater;
}

function getNearestWorkArea(cx, cy) {
  const displays = getDisplaysSafe(screen);
  for (const d of displays) {
    const wa = d.workArea || d.bounds;
    if (!wa) continue;
    if (cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height) {
      return wa;
    }
  }
  return primaryWorkArea(screen);
}

function getMini() {
  if (!mini) {
    mini = createMiniController({
      getWindow: () => mainWindow,
      getNearestWorkArea,
      clampPosition: (x, y, w, h) => clampToDisplays(screen, x, y, w, h),
      persistMiniState: (state) => {
        saveConfig({
          miniMode: !!state.miniMode,
          miniEdge: state.miniEdge === 'left' ? 'left' : 'right',
          preMiniX: state.preMiniX,
          preMiniY: state.preMiniY,
        });
        if (mainWindow && !mainWindow.isDestroyed() && !state.miniMode) {
          saveThemePosition();
        }
      },
      sendMiniModeChange: (enabled, edge) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mini-mode-change', {
            enabled: !!enabled,
            edge: edge || 'right',
          });
        }
      },
      sendMiniPeek: (peeking) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mini-peek', !!peeking);
        }
      },
      applyMiniPetState: (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mini-pet-state', state || 'miniIdle');
        }
      },
      onMiniExited: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mini-exited');
        }
      },
      rebuildMenus: () => rebuildTrayMenu(),
      isDoNotDisturb: () => !!loadConfig().doNotDisturb,
      getTheme: () => themeLoader.loadTheme(currentThemeId()),
      getMiniEnterDurationMs: () => {
        const t = themeLoader.loadTheme(currentThemeId());
        // Canvas themes have no miniEnter clip — keep transition short so drag isn't blocked
        if (t?.type === 'blackhole' || t?.type === 'saturn') return 180;
        return t?.timings?.miniEnter || 1200;
      },
    });
    const theme = themeLoader.loadTheme(currentThemeId());
    mini.refreshTheme(theme);
  }
  return mini;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      // Never keep plaintext key in config after migration
      const { aiApiKey: _drop, ...rest } = raw || {};
      return { ...DEFAULT_CONFIG, ...rest };
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(partial) {
  const merged = { ...loadConfig(), ...partial };
  // Strip any accidental key fields — secrets live in ai-secrets.json
  const { aiApiKey: _a, aiApiKeyEnc: _b, ...next } = merged;
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  } catch (_) {}
  return next;
}

function noteActivity() {
  lastActiveAt = Date.now();
}

function lockedSize() {
  return Math.round(Math.max(160, Math.min(720, loadConfig().size || 360)));
}

function currentThemeId() {
  return loadConfig().theme || 'blackhole';
}

/**
 * Content protection hides the HWND from screen recorders (EV / OBS / Win+G).
 * Needed only for blackhole desktop-warp refresh; pets/saturn stay capturable.
 * Tray「录屏可见」forces protection off for every theme.
 */
function wantContentProtection() {
  if (loadConfig().allowScreenCapture) return false;
  return isBlackholeTheme();
}

function applyContentProtection() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const on = wantContentProtection();
  try {
    mainWindow.setContentProtection(on);
  } catch (err) {
    console.warn('[capture] setContentProtection failed', err);
  }
}

function setAllowScreenCapture(on) {
  saveConfig({ allowScreenCapture: !!on });
  applyContentProtection();
  rebuildTrayMenu();
}

function isBlackholeTheme(themeId) {
  const t = themeLoader.loadTheme(themeId || currentThemeId());
  return !t || t.type === 'blackhole';
}

function isSaturnTheme(themeId) {
  const t = themeLoader.loadTheme(themeId || currentThemeId());
  return !!(t && t.type === 'saturn');
}

function themeAspect(themeId) {
  const t = themeLoader.loadTheme(themeId || currentThemeId());
  if (!t || t.type === 'blackhole') return 1;
  if (t.type === 'saturn') return t.aspect > 0 ? t.aspect : 0.72;
  return t.aspect > 0 ? t.aspect : 200 / 266;
}

function boundsForSize(size, themeId, cx, cy) {
  const scale = isBlackholeTheme(themeId) ? 1.15 : isSaturnTheme(themeId) ? 1.25 : 1;
  const w = Math.round(size * scale);
  const h = Math.round(size * scale * themeAspect(themeId));
  return {
    width: w,
    height: h,
    x: Math.round(cx - w / 2),
    y: Math.round(cy - h / 2),
  };
}

function clampMainWindow(x, y) {
  if (!mainWindow || mainWindow.isDestroyed()) return { x, y };
  const [w, h] = mainWindow.getSize();
  return clampToDisplays(screen, x, y, w, h);
}

function applyClampedBounds(x, y, w, h) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // While docked in mini mode, keep the half-hidden X (don't pull back on-screen)
  if (getMini().getMiniMode() && !getMini().getMiniTransitioning()) {
    const pos = { x, y };
    mainWindow.setBounds({ x: pos.x, y: pos.y, width: w, height: h });
    return pos;
  }
  const pos = clampToDisplays(screen, x, y, w, h);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width: w, height: h });
  return pos;
}

function stopDragFollow() {
  if (dragFollowTimer) {
    clearInterval(dragFollowTimer);
    dragFollowTimer = null;
  }
}

/** Keep window glued to cursor in main process (~60fps), not only on renderer IPC. */
function followDragCursor() {
  if (!userDragging || !mainWindow || mainWindow.isDestroyed()) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  if (!dragLockSize || !dragGrabOffset) return;
  const point = screen.getCursorScreenPoint();
  const wantX = Math.round(point.x - dragGrabOffset.x);
  const wantY = Math.round(point.y - dragGrabOffset.y);
  const pos = applyClampedBounds(wantX, wantY, dragLockSize.width, dragLockSize.height);
  // If clamp blocked movement, re-anchor grab so cursor doesn't drift away from the pet
  if (pos && (pos.x !== wantX || pos.y !== wantY)) {
    dragGrabOffset = { x: point.x - pos.x, y: point.y - pos.y };
  }
}

function startDragFollow() {
  stopDragFollow();
  followDragCursor();
  dragFollowTimer = setInterval(followDragCursor, 16);
}

function saveThemePosition(themeId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const id = themeId || currentThemeId();
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const pos = clampToDisplays(screen, x, y, w, h);
  const disp = screen.getDisplayMatching({ x: pos.x, y: pos.y, width: w, height: h });
  const cfg = loadConfig();
  const themePositions = { ...(cfg.themePositions || {}) };
  themePositions[id] = {
    x: pos.x,
    y: pos.y,
    displayId: disp?.id ?? null,
    display: displaySnapshot(disp),
  };
  saveConfig({ x: pos.x, y: pos.y, themePositions });
}

function restoreThemePosition(themeId, size) {
  const cfg = loadConfig();
  const saved = (cfg.themePositions || {})[themeId];
  const dims = boundsForSize(size, themeId, 0, 0);
  const w = dims.width;
  const h = dims.height;

  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    const stillThere =
      saved.displayId == null || findDisplayById(screen, saved.displayId) != null;
    if (stillThere) {
      return { ...clampToDisplays(screen, saved.x, saved.y, w, h), width: w, height: h };
    }
  }
  const wa = primaryWorkArea(screen);
  const c = centerOnWorkArea(wa, w, h);
  return { ...c, width: w, height: h };
}

function enforceLockedSize() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  const cfg = loadConfig();
  const s = lockedSize();
  const theme = cfg.theme || 'blackhole';
  const [x, y] = mainWindow.getPosition();
  const [cw, ch] = mainWindow.getSize();
  const target = boundsForSize(s, theme, 0, 0);
  if (cw !== target.width || ch !== target.height) {
    // Keep top-left; only correct width/height
    mainWindow.setBounds({ x, y, width: target.width, height: target.height });
  }
}

function setClickThroughEnabled(ignore) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mousePassthrough = !!ignore;
  const cfg = loadConfig();
  if (cfg.clickThrough === false) {
    try {
      mainWindow.setIgnoreMouseEvents(false);
    } catch (_) {}
    mousePassthrough = false;
    return;
  }
  try {
    if (ignore) mainWindow.setIgnoreMouseEvents(true, { forward: true });
    else mainWindow.setIgnoreMouseEvents(false);
  } catch (_) {
    try {
      mainWindow.setIgnoreMouseEvents(false);
    } catch (__) {}
  }
}

function cursorOverMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
  try {
    const point = screen.getCursorScreenPoint();
    const b = mainWindow.getBounds();
    return (
      point.x >= b.x &&
      point.x < b.x + b.width &&
      point.y >= b.y &&
      point.y < b.y + b.height
    );
  } catch (_) {
    return false;
  }
}

/** Recover click-through after alt-tab / focus loss (renderer mouseleave is unreliable). */
function syncClickThroughFromCursor() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (userDragging || userResizing) return;
  try {
    if (getMini().getMiniMode() || getMini().getMiniTransitioning()) {
      if (mousePassthrough) setClickThroughEnabled(false);
      return;
    }
  } catch (_) {}
  const cfg = loadConfig();
  if (cfg.clickThrough === false) {
    if (mousePassthrough) setClickThroughEnabled(false);
    return;
  }
  const over = cursorOverMainWindow();
  // Only recover stuck ignore=true while cursor is over us.
  // Leaving / re-enabling passthrough stays in the renderer to avoid fighting #hit.
  if (over && mousePassthrough) {
    setClickThroughEnabled(false);
    try {
      mainWindow.webContents.send('click-through-wake');
    } catch (_) {}
  }
}

let clickThroughWatch = null;
function startClickThroughWatch() {
  if (clickThroughWatch) return;
  clickThroughWatch = setInterval(syncClickThroughFromCursor, 160);
}

function sendThemePayload(themeId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const theme = themeLoader.loadTheme(themeId || currentThemeId());
  const cfg = loadConfig();
  mainWindow.webContents.send('theme-changed', {
    ...themeLoader.themePayload(theme),
    doNotDisturb: !!cfg.doNotDisturb,
    lowPowerIdle: cfg.lowPowerIdle !== false,
    clickThrough: cfg.clickThrough !== false,
  });
}

function pushCropFrame(force = false) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  if (!isBlackholeTheme()) return;
  if (loadConfig().doNotDisturb) return;
  if (!hasPlate()) return;
  const frame = cropPlateForWindow(mainWindow);
  if (!frame) return;
  // Idle loop used to re-JPEG the same crop every ~140ms → compression noise looked like flashing
  if (!force && frame.cropKey && frame.cropKey === lastCropKey) return;
  lastCropKey = frame.cropKey || lastCropKey;
  mainWindow.webContents.send('desktop-frame', {
    data: frame.data,
    padRatio: frame.padRatio,
    mime: frame.mime || 'image/jpeg',
  });
}

function cropIntervalMs() {
  const cfg = loadConfig();
  if (cfg.doNotDisturb) return 4000;
  // Rare soft checks only — real updates happen on move / plate refresh
  if (cfg.lowPowerIdle !== false && Date.now() - lastActiveAt > 25000) return 8000;
  return 2500;
}

function scheduleCropAfterMove() {
  // Never hide-capture while the user is dragging or resizing
  if (userDragging || userResizing) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  clearTimeout(moveCropTimer);
  clearTimeout(fullPlateTimer);
  moveCropTimer = setTimeout(() => {
    if (userDragging || userResizing) return;
    if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
    isMoving = false;
    enforceLockedSize();
    if (!isBlackholeTheme() || loadConfig().doNotDisturb) {
      pushCropFrame(true);
      return;
    }
    // Full-screen plate already covers the display — just re-crop.
    // Never re-capture here (that used to hide/opacity the window → flash).
    pushCropFrame(true);
  }, 200);
}

function startCropLoop() {
  stopCropLoop();
  if (loadConfig().doNotDisturb) return;
  const tick = () => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !capturePaused &&
      !isMoving &&
      isBlackholeTheme() &&
      !loadConfig().doNotDisturb
    ) {
      pushCropFrame(false);
    }
    cropTimer = setTimeout(tick, cropIntervalMs());
  };
  cropTimer = setTimeout(tick, 200);
}

function stopCropLoop() {
  if (cropTimer) {
    clearTimeout(cropTimer);
    cropTimer = null;
  }
}

async function quietRefreshPlate() {
  if (!mainWindow || mainWindow.isDestroyed() || capturePaused) return;
  if (!isBlackholeTheme() || loadConfig().doNotDisturb) return;
  if (userDragging || userResizing) return;
  capturePaused = true;
  try {
    // Never hide/opacity — capture sees through via setContentProtection
    const ok = await refreshPlateLive(mainWindow);
    if (ok) {
      lastCropKey = '';
      pushCropFrame(true);
    }
  } finally {
    capturePaused = false;
  }
}

let quietPlateTimer = null;
function scheduleQuietPlateRefresh(delay = 380) {
  if (!isBlackholeTheme() || loadConfig().doNotDisturb) return;
  clearTimeout(quietPlateTimer);
  quietPlateTimer = setTimeout(() => {
    quietPlateTimer = null;
    quietRefreshPlate();
  }, delay);
}

function clampPetSize(size) {
  return Math.round(Math.max(SIZE_MIN, Math.min(SIZE_MAX, size)));
}

function ensureBaseSize(cfg = loadConfig()) {
  if (cfg.baseSize == null || !Number.isFinite(Number(cfg.baseSize))) {
    const clamped = clampPetSize(cfg.size || 360);
    saveConfig({ baseSize: clamped });
    return clamped;
  }
  const clamped = clampPetSize(cfg.baseSize);
  if (clamped !== cfg.baseSize) saveConfig({ baseSize: clamped });
  return clamped;
}

function applyWindowSize(
  size,
  { anchor = 'topleft', updateBase = false, quiet = false, center = null, persist = true } = {}
) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (userDragging) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  const clamped = clampPetSize(size);
  const theme = currentThemeId();
  const bounds = mainWindow.getBounds();
  const dims = boundsForSize(clamped, theme, 0, 0);
  let x = bounds.x;
  let y = bounds.y;
  if (anchor === 'center') {
    // Prefer a locked center (grow anim) so getBounds drift doesn't walk the window
    const cx = Number.isFinite(center?.x) ? center.x : bounds.x + bounds.width / 2;
    const cy = Number.isFinite(center?.y) ? center.y : bounds.y + bounds.height / 2;
    x = Math.round(cx - dims.width / 2);
    y = Math.round(cy - dims.height / 2);
  }

  // Clamp with full size in one shot — never setPosition alone (transparent win jump)
  const pos = clampToDisplays(screen, x, y, dims.width, dims.height);
  x = pos.x;
  y = pos.y;

  userResizing = true;
  isMoving = true;
  clearTimeout(moveCropTimer);
  try {
    mainWindow.setBounds({
      x,
      y,
      width: dims.width,
      height: dims.height,
    });
    if (persist) {
      const patch = { size: clamped, x, y };
      if (updateBase) patch.baseSize = clamped;
      saveConfig(patch);
      saveThemePosition(theme);
    }
    mainWindow.webContents.send('size-changed', clamped);
    if (!quiet) pushCropFrame(true);
  } finally {
    if (!quiet) {
      setTimeout(() => {
        userResizing = false;
        isMoving = false;
        if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
          scheduleCropAfterMove();
        }
      }, 120);
    }
  }
}

function setWindowSize(size, { anchor = 'topleft', updateBase = false, animate = false } = {}) {
  if (!mainWindow) return;
  if (userDragging) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  noteActivity();
  const clamped = clampPetSize(size);
  if (animate) {
    animateWindowSize(clamped, { anchor, updateBase });
    return;
  }
  applyWindowSize(clamped, { anchor, updateBase, quiet: false });
}

function stopSizeAnim() {
  if (sizeAnimTimer) {
    clearInterval(sizeAnimTimer);
    sizeAnimTimer = null;
  }
}

function animateWindowSize(target, { anchor = 'center', updateBase = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (userDragging) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  stopSizeAnim();
  noteActivity();
  const from = clampPetSize(loadConfig().size || 360);
  const to = clampPetSize(target);
  if (from === to) {
    if (updateBase) saveConfig({ baseSize: to });
    return;
  }
  // Lock visual center for the whole tween — recalculating from getBounds each
  // frame makes the hole slide first, then appear to grow.
  const start = mainWindow.getBounds();
  const lockedCenter =
    anchor === 'center'
      ? { x: start.x + start.width / 2, y: start.y + start.height / 2 }
      : null;
  const steps = 14;
  let i = 0;
  userResizing = true;
  isMoving = true;
  sizeAnimTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || userDragging) {
      stopSizeAnim();
      userResizing = false;
      isMoving = false;
      return;
    }
    i += 1;
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const next = Math.round(from + (to - from) * ease);
    const done = i >= steps;
    applyWindowSize(done ? to : next, {
      anchor,
      updateBase: done ? updateBase : false,
      quiet: true,
      center: lockedCenter,
      persist: done,
    });
    if (done) {
      stopSizeAnim();
      pushCropFrame(true);
      // Keep userResizing until moved/resize events from the last setBounds settle
      setTimeout(() => {
        userResizing = false;
        isMoving = false;
        if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
          scheduleCropAfterMove();
        }
      }, 160);
    }
  }, 28);
}

function growFromFeed(itemCount) {
  if (!mainWindow || getMini().getMiniMode()) return;
  const cfg = loadConfig();
  ensureBaseSize(cfg);
  const current = clampPetSize(cfg.size || 360);
  const bump = Math.max(1, itemCount | 0) * GROW_PER_ITEM;
  const next = clampPetSize(current + bump);
  if (next <= current) return;
  animateWindowSize(next, { anchor: 'center', updateBase: false });
  try {
    mainWindow.webContents.send('pet-grown', {
      size: next,
      baseSize: ensureBaseSize(),
      gained: next - current,
    });
  } catch (_) {}
}

function shrinkToBaseSize({ reason = 'manual' } = {}) {
  if (!mainWindow || getMini().getMiniMode()) return false;
  const cfg = loadConfig();
  const base = ensureBaseSize(cfg);
  const current = clampPetSize(cfg.size || 360);
  if (current <= base) return false;
  animateWindowSize(base, { anchor: 'center', updateBase: false });
  try {
    mainWindow.webContents.send('pet-shrunk', { size: base, baseSize: base, reason });
  } catch (_) {}
  return true;
}

function startRecycleBinWatcher() {
  if (recycleBinWatcher) return;
  recycleBinWatcher = createRecycleBinWatcher({
    onEmpty: () => {
      shrinkToBaseSize({ reason: 'empty-bin' });
      rebuildTrayMenu();
    },
    onCount: (n) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        mainWindow.webContents.send('recycle-bin-count', n);
      } catch (_) {}
    },
  });
  recycleBinWatcher.start();
}

function sendMediaActivity(on) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (loadConfig().doNotDisturb) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  try {
    mainWindow.webContents.send('media-activity', !!on);
  } catch (_) {}
}

function sendTypingActivity(on) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (loadConfig().doNotDisturb) return;
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  try {
    mainWindow.webContents.send('typing-activity', !!on);
  } catch (_) {}
}

function mediaPlayingNow() {
  try {
    return !!mediaActivity.isPlaying();
  } catch (_) {
    return false;
  }
}

function syncTypingKeyboardMonitor() {
  const theme = themeLoader.loadTheme(currentThemeId());
  const want = !!(theme && theme.type === 'pet');
  if (!want) {
    keyboardActivity.stop();
    mediaActivity.stop();
    if (syncTypingKeyboardMonitor._mediaSync) {
      clearInterval(syncTypingKeyboardMonitor._mediaSync);
      syncTypingKeyboardMonitor._mediaSync = null;
    }
    return;
  }
  keyboardActivity.start((on) => {
    sendTypingActivity(on);
  });
  mediaActivity.start((on) => {
    sendMediaActivity(on);
  });
  // Catch-up: probe may have flipped before BrowserWindow was ready
  sendMediaActivity(mediaActivity.isPlaying());
  sendTypingActivity(keyboardActivity.isTyping());
  setTimeout(() => {
    mediaActivity.notify?.();
    sendMediaActivity(mediaActivity.isPlaying());
    sendTypingActivity(keyboardActivity.isTyping());
  }, 800);
  setTimeout(() => {
    mediaActivity.notify?.();
    sendMediaActivity(mediaActivity.isPlaying());
    sendTypingActivity(keyboardActivity.isTyping());
  }, 2200);
  // Periodic resync — recovers missed IPC / theme-enable races
  if (syncTypingKeyboardMonitor._mediaSync) {
    clearInterval(syncTypingKeyboardMonitor._mediaSync);
  }
  syncTypingKeyboardMonitor._mediaSync = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const themeNow = themeLoader.loadTheme(currentThemeId());
    if (!themeNow || themeNow.type !== 'pet') return;
    sendMediaActivity(mediaActivity.isPlaying());
    sendTypingActivity(keyboardActivity.isTyping());
  }, 2000);
  if (syncTypingKeyboardMonitor._mediaSync.unref) {
    syncTypingKeyboardMonitor._mediaSync.unref();
  }
}

function setTheme(themeId) {
  const theme = themeLoader.loadTheme(themeId);
  if (!theme) return;
  noteActivity();
  if (getMini().getMiniMode()) {
    getMini().exitMiniMode();
  }

  // Keep on-screen place: resize around current center (do not jump to another theme's saved spot)
  let cx = 0;
  let cy = 0;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const [x, y] = mainWindow.getPosition();
    const [w, h] = mainWindow.getSize();
    cx = x + w / 2;
    cy = y + h / 2;
  }

  saveConfig({ theme: theme.id });
  if (!mainWindow || mainWindow.isDestroyed()) return;

  getMini().refreshTheme(theme);

  const next = boundsForSize(lockedSize(), theme.id, cx, cy);
  applyClampedBounds(next.x, next.y, next.width, next.height);
  saveThemePosition(theme.id);

  sendThemePayload(theme.id);
  syncTypingKeyboardMonitor();
  applyContentProtection();

  if (theme.type === 'blackhole' && !loadConfig().doNotDisturb) {
    quietRefreshPlate();
    startCropLoop();
  } else {
    stopCropLoop();
  }
  setClickThroughEnabled(true);
  rebuildTrayMenu();
}

function setOpenAtLogin(enable) {
  const on = !!enable;
  saveConfig({ openAtLogin: on });
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: on });
    } else {
      app.setLoginItemSettings({
        openAtLogin: on,
        path: process.execPath,
        args: [path.resolve(__dirname)],
      });
    }
  } catch (err) {
    console.warn('setLoginItemSettings failed', err);
  }
  rebuildTrayMenu();
}

function hydrateOpenAtLogin() {
  const cfg = loadConfig();
  try {
    setOpenAtLogin(!!cfg.openAtLogin);
  } catch (_) {}
}

function setDoNotDisturb(on) {
  const next = !!on;
  saveConfig({ doNotDisturb: next });
  noteActivity();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dnd-changed', next);
  }
  if (next) {
    stopCropLoop();
  } else if (isBlackholeTheme()) {
    startCropLoop();
    quietRefreshPlate();
  }
  rebuildTrayMenu();
}

function setLowPowerIdle(on) {
  saveConfig({ lowPowerIdle: !!on });
  noteActivity();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('low-power-changed', !!on);
  }
  rebuildTrayMenu();
}

function setClickThroughPref(on) {
  saveConfig({ clickThrough: !!on });
  setClickThroughEnabled(!!on ? true : false);
  if (!on) setClickThroughEnabled(false);
  else setClickThroughEnabled(true);
  rebuildTrayMenu();
}

function moveToDisplay(displayId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  noteActivity();
  const d = findDisplayById(screen, displayId) || screen.getPrimaryDisplay();
  const [w, h] = mainWindow.getSize();
  const c = centerOnWorkArea(d.workArea, w, h);
  applyClampedBounds(c.x, c.y, w, h);
  saveThemePosition();
  if (isBlackholeTheme() && !loadConfig().doNotDisturb) quietRefreshPlate();
}

function displayMenuItems() {
  const displays = getDisplaysSafe(screen);
  if (displays.length <= 1) {
    return [{ label: '（仅一块屏幕）', enabled: false }];
  }
  return displays.map((d, i) => ({
    label: `显示器 ${i + 1} (${d.size.width}×${d.size.height})`,
    click: () => moveToDisplay(d.id),
  }));
}

async function createWindow() {
  const config = loadConfig();
  const size = Math.max(160, Math.min(720, config.size || 360));
  const theme = config.theme || 'blackhole';
  const placed = restoreThemePosition(theme, size);
  // Fallback to legacy x/y if no per-theme entry yet
  if (
    !(config.themePositions || {})[theme] &&
    config.x != null &&
    config.y != null
  ) {
    const c = clampToDisplays(screen, config.x, config.y, placed.width, placed.height);
    placed.x = c.x;
    placed.y = c.y;
  }
  const blankTitle = ' ';

  mainWindow = new BrowserWindow({
    width: placed.width,
    height: placed.height,
    x: placed.x,
    y: placed.y,
    title: blankTitle,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    autoHideMenuBar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: config.alwaysOnTop !== false,
    focusable: true,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      webSecurity: false,
    },
  });

  mainWindow.setTitle(blankTitle);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.setAlwaysOnTop(config.alwaysOnTop !== false, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Blackhole only: exclude from capture so desktop underlay can refresh
  // without hide/opacity flash. Pets/saturn stay visible to EV/OBS.
  applyContentProtection();
  const clearChrome = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setBackgroundColor('#00000000');
    try {
      mainWindow.setHasShadow(false);
    } catch (_) {}
  };
  clearChrome();

  const keepBlankTitle = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(blankTitle);
  };
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    keepBlankTitle();
  });

  if (process.platform === 'win32') {
    try {
      if (typeof mainWindow.setBackgroundMaterial === 'function') {
        mainWindow.setBackgroundMaterial('none');
      }
    } catch (_) {}

    try {
      mainWindow.hookWindowMessage(0x0086, () => true);
    } catch (_) {}

    const forceRedraw = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      clearChrome();
      keepBlankTitle();
      // Black hole warp jumps hard on a 1px size pulse — skip it there
      if (isBlackholeTheme()) {
        try {
          mainWindow.webContents.invalidate?.();
        } catch (_) {}
        return;
      }
      try {
        const [w, h] = mainWindow.getSize();
        const [x, y] = mainWindow.getPosition();
        allowPulseResize = true;
        mainWindow.setBounds({ x, y, width: w, height: h + 1 });
        mainWindow.setBounds({ x, y, width: w, height: h });
      } catch (_) {
      } finally {
        allowPulseResize = false;
      }
    };

    mainWindow.on('show', () => {
      clearChrome();
      keepBlankTitle();
      setTimeout(forceRedraw, 30);
    });
    mainWindow.on('focus', () => {
      forceRedraw();
      try {
        mainWindow.webContents.send('click-through-wake');
      } catch (_) {}
      syncClickThroughFromCursor();
      scheduleQuietPlateRefresh(220);
    });
    mainWindow.on('blur', () => {
      forceRedraw();
      // Alt-tab often leaves ignore stuck; re-check real cursor immediately
      syncClickThroughFromCursor();
      // Desktop behind changed — soft recapture so warp crossfades to new scene
      scheduleQuietPlateRefresh(420);
    });
  } else {
    mainWindow.on('focus', () => {
      keepBlankTitle();
      try {
        mainWindow.webContents.send('click-through-wake');
      } catch (_) {}
      syncClickThroughFromCursor();
      scheduleQuietPlateRefresh(220);
    });
    mainWindow.on('blur', () => {
      syncClickThroughFromCursor();
      scheduleQuietPlateRefresh(420);
    });
    mainWindow.on('show', keepBlankTitle);
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', async () => {
    applyContentProtection();
    if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
      const disp = screen.getDisplayMatching(mainWindow.getBounds());
      await refreshDesktopPlate(disp);
    }
    mainWindow.show();
    applyContentProtection();
    setClickThroughEnabled(true);
    startClickThroughWatch();
    sendThemePayload();
    if (loadConfig().doNotDisturb) {
      mainWindow.webContents.send('dnd-changed', true);
    }
    pushCropFrame(true);
    if (isBlackholeTheme() && !loadConfig().doNotDisturb) startCropLoop();
  });

  mainWindow.on('will-move', () => {
    isMoving = true;
  });

  mainWindow.on('moved', () => {
    if (!mainWindow) return;
    isMoving = true;
    // Active user drag already clamps + will save on drag-end
    if (userDragging || userResizing || sizeAnimTimer) return;
    if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
    noteActivity();
    const b = mainWindow.getBounds();
    const pos = clampToDisplays(screen, b.x, b.y, b.width, b.height);
    // Always setBounds (size+pos) — setPosition alone makes transparent windows jump/grow
    if (pos.x !== b.x || pos.y !== b.y) {
      mainWindow.setBounds({ x: pos.x, y: pos.y, width: b.width, height: b.height });
    }
    saveThemePosition();
    scheduleCropAfterMove();
  });

  mainWindow.on('resize', () => {
    if (allowPulseResize || userResizing || userDragging) return;
    enforceLockedSize();
  });
  mainWindow.on('will-resize', (e) => {
    if (!allowPulseResize) e.preventDefault();
  });

  mainWindow.on('closed', () => {
    stopCropLoop();
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('黑洞回收站');
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.focus();
    else mainWindow.show();
  });
  rebuildTrayMenu();
}

function getAiConfig() {
  const cfg = loadConfig();
  return {
    apiKey: aiSecrets.getApiKey(),
    baseUrl: normalizeBaseUrl(cfg.aiBaseUrl || DEFAULT_BASE),
    model: String(cfg.aiModel || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    encryption: aiSecrets.canEncrypt(),
    presets: PROVIDER_PRESETS,
  };
}

function openSizeSettingsWindow() {
  if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
  if (sizeSettingsWin && !sizeSettingsWin.isDestroyed()) {
    sizeSettingsWin.focus();
    return;
  }
  sizeSettingsWin = new BrowserWindow({
    width: 380,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '调整尺寸',
    autoHideMenuBar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    show: false,
    backgroundColor: '#12141a',
    webPreferences: {
      preload: path.join(__dirname, 'size-settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  sizeSettingsWin.setMenuBarVisibility(false);
  sizeSettingsWin.loadFile(path.join(__dirname, 'size-settings.html'));
  sizeSettingsWin.once('ready-to-show', () => {
    if (sizeSettingsWin && !sizeSettingsWin.isDestroyed()) sizeSettingsWin.show();
  });
  sizeSettingsWin.on('closed', () => {
    sizeSettingsWin = null;
  });
}

function openAiSettingsWindow() {
  if (aiSettingsWin && !aiSettingsWin.isDestroyed()) {
    aiSettingsWin.focus();
    return;
  }
  aiSettingsWin = new BrowserWindow({
    width: 500,
    height: 580,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'AI 设置',
    autoHideMenuBar: true,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    show: false,
    backgroundColor: '#12141a',
    webPreferences: {
      preload: path.join(__dirname, 'ai-settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aiSettingsWin.setMenuBarVisibility(false);
  aiSettingsWin.loadFile(path.join(__dirname, 'ai-settings.html'));
  aiSettingsWin.once('ready-to-show', () => {
    if (aiSettingsWin && !aiSettingsWin.isDestroyed()) aiSettingsWin.show();
  });
  aiSettingsWin.on('closed', () => {
    aiSettingsWin = null;
  });
}

async function askCharacterDescription({ hint, seed } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        if (win && !win.isDestroyed()) win.close();
      } catch (_) {}
      resolve(value);
    };

    const win = new BrowserWindow({
      width: 460,
      height: 360,
      resizable: true,
      minimizable: false,
      maximizable: false,
      title: '角色描述',
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      modal: true,
      show: false,
      backgroundColor: '#12141a',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'ai-desc-prompt-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setMenuBarVisibility(false);
    const q = new URLSearchParams();
    if (hint) q.set('hint', hint);
    if (seed) q.set('seed', seed);
    win.loadFile(path.join(__dirname, 'ai-desc-prompt.html'), { query: Object.fromEntries(q) });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show();
    });
    win.on('closed', () => finish(null));

    const onSubmit = (_e, text) => {
      ipcMain.removeListener('ai-desc-submit', onSubmit);
      ipcMain.removeListener('ai-desc-cancel', onCancel);
      finish(String(text || '').trim() || null);
    };
    const onCancel = () => {
      ipcMain.removeListener('ai-desc-submit', onSubmit);
      ipcMain.removeListener('ai-desc-cancel', onCancel);
      finish(null);
    };
    ipcMain.on('ai-desc-submit', onSubmit);
    ipcMain.on('ai-desc-cancel', onCancel);
  });
}

async function createThemeFromImageDialog() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  let ai = getAiConfig();
  if (!ai.apiKey) {
    const ask = await dialog.showMessageBox(win || undefined, {
      type: 'info',
      buttons: ['去填写 API Key', '取消'],
      defaultId: 0,
      cancelId: 1,
      title: '需要 API Key',
      message: '生成主题需要你自己的 AI API Key',
      detail:
        '推荐 DeepSeek / 硅基流动 / 百炼等国内预设：在「AI 设置」点选后填入对应 Key 并保存。',
    });
    if (ask.response === 0) openAiSettingsWindow();
    return;
  }

  const endpoint = assessEndpoint(ai.baseUrl, ai.model);

  // Any risky overseas host (OpenAI / Anthropic / Google …) — warn early
  if (endpoint.riskyForeign) {
    const ask = await dialog.showMessageBox(win || undefined, {
      type: 'warning',
      buttons: ['打开 AI 设置改国内预设', '仍然继续', '取消'],
      defaultId: 0,
      cancelId: 2,
      title: '当前接口在国内易被拦截',
      message: `检测到海外地址：${endpoint.host || endpoint.root}`,
      detail:
        `预设：${endpoint.presetLabel}\n模型：${endpoint.model}\n\n` +
        '国内直连 OpenAI / Claude / Gemini 等常被网关拦截（429 Request Blocked）。\n' +
        '请改选 DeepSeek、硅基流动、百炼、智谱等，并使用该服务商自己的 API Key。',
    });
    if (ask.response === 2) return;
    if (ask.response === 0) {
      openAiSettingsWindow();
      return;
    }
  }

  // Preflight before asking for image/description — catch bad Key / blocked host early
  {
    let progressWin = null;
    try {
      progressWin = new BrowserWindow({
        width: 360,
        height: 120,
        frame: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: '预检中',
        parent: win || undefined,
        modal: true,
        show: true,
        autoHideMenuBar: true,
        backgroundColor: '#12141a',
        webPreferences: { sandbox: true },
      });
      progressWin.setMenuBarVisibility(false);
      progressWin.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            `<body style="margin:0;background:#12141a;color:#e8ecf4;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:16px;text-align:center;font-size:13px">正在预检 ${endpoint.host || 'AI 接口'}…</body>`
          )
      );
    } catch (_) {}
    const check = await preflightAi(ai);
    try {
      if (progressWin && !progressWin.isDestroyed()) progressWin.close();
    } catch (_) {}
    if (!check.ok) {
      const fail = await dialog.showMessageBox(win || undefined, {
        type: 'error',
        buttons: check.blocked
          ? ['打开 AI 设置', '取消']
          : ['仍然继续', '打开 AI 设置', '取消'],
        defaultId: 0,
        cancelId: check.blocked ? 1 : 2,
        title: '预检失败',
        message: '当前 AI 接口不可用',
        detail:
          (check.message || '请检查 Base URL / Key / 模型') +
          `\n\n当前：${ai.baseUrl}\n模型：${ai.model}` +
          (check.blocked
            ? '\n\n若被网关拦截，请改用 DeepSeek / 硅基流动 / 百炼 / 智谱等国内预设。'
            : ''),
      });
      if (check.blocked) {
        if (fail.response === 0) openAiSettingsWindow();
        return;
      }
      if (fail.response === 1) {
        openAiSettingsWindow();
        return;
      }
      if (fail.response === 2) return;
    }
  }

  ai = getAiConfig();
  const cap = detectVisionSupport(ai.baseUrl, ai.model);
  let imagePath = null;

  if (cap.vision !== false) {
    const result = await dialog.showOpenDialog(win || undefined, {
      title: '选一张参考图（识图；失败时自动改用文字描述）',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) return;
    imagePath = result.filePaths[0];
  }

  // Always collect text description as fallback for ANY provider (vision or not)
  const seedName = imagePath
    ? path.basename(imagePath, path.extname(imagePath))
    : '';
  const description = await askCharacterDescription({
    hint:
      cap.vision === false
        ? `${cap.reason || '当前接口不支持识图'}。\n当前：${ai.baseUrl}\n模型：${ai.model}`
        : '建议填写文字描述作备用：识图失败、网关拦截或不支持 Vision 时会自动改用文字生成。',
    seed: seedName
      ? `角色参考名：${seedName}。请补充：物种/体型、主色与花纹、表情气质、服饰或配件、坐姿或站姿。`
      : '请描述：物种/体型、主色与花纹、表情气质、服饰或配件、坐姿或站姿。',
  });
  if (!description) return;

  // Non-blocking progress window
  let progress = null;
  const setProgressText = (text) => {
    if (!progress || progress.isDestroyed()) return;
    const safe = String(text || '正在生成…')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    progress.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="margin:0;background:#12141a;color:#e8ecf4;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:10px;padding:16px;text-align:center">` +
            `<div style="font-size:14px;line-height:1.5">${safe}</div>` +
            `<div style="font-size:11px;color:#8b93a7">${ai.baseUrl} · ${ai.model}</div>` +
            `</body>`
        )
    );
  };
  try {
    progress = new BrowserWindow({
      width: 380,
      height: 150,
      frame: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: '正在生成主题',
      parent: win || undefined,
      modal: false,
      show: true,
      autoHideMenuBar: true,
      backgroundColor: '#12141a',
      webPreferences: { sandbox: true },
    });
    progress.setMenuBarVisibility(false);
    setProgressText('准备中…');
  } catch (_) {}

  ai = getAiConfig();
  const created = await createThemeFromImage(
    imagePath,
    themeLoader.getUserThemesDir(),
    {
      ...ai,
      description,
      forceText: cap.vision === false,
    },
    setProgressText
  );
  try {
    if (progress && !progress.isDestroyed()) progress.close();
  } catch (_) {}

  if (created.status !== 'ok') {
    const blocked =
      /网关拦截|Request Blocked|openai\.com|anthropic\.com|googleapis\.com/i.test(
        created.message || ''
      );
    await dialog.showMessageBox(win || undefined, {
      type: 'error',
      title: '生成失败',
      message: 'AI 生成主题失败',
      detail:
        (created.message || '请检查 API Key、Base URL、模型名') +
        (blocked
          ? '\n\n请打开「AI 设置」→ 改选国内预设（DeepSeek / 硅基流动 / 百炼等）→ 填入对应 Key → 保存。'
          : `\n\n当前配置：${ai.baseUrl}\n模型：${ai.model}\n可先在 AI 设置里点「测试连接」确认。`),
    });
    return;
  }

  rebuildTrayMenu();
  setTheme(created.themeId);
  await dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: '主题已生成',
    message: `「${created.name}」已就绪`,
    detail:
      created.mode === 'text'
        ? '已按文字描述生成并自动切换。'
        : '已自动切换到新皮肤。',
  });
}

async function importThemeZipDialog() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '导入主题包',
    properties: ['openFile'],
    filters: [{ name: '主题包 (zip)', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return;
  const imported = await themeImporter.importUserThemeZip(
    result.filePaths[0],
    themeLoader.getUserThemesDir()
  );
  if (imported.status === 'ok') {
    rebuildTrayMenu();
    setTheme(imported.themeId);
    await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: '导入成功',
      message: `已导入并切换到「${imported.name}」`,
    });
  } else {
    await dialog.showMessageBox(win || undefined, {
      type: 'error',
      title: '导入失败',
      message: '导入主题包失败',
      detail: imported.message || '未知错误',
    });
  }
}

function deleteUserThemeMenuItems() {
  const userThemes = themeLoader.listThemes().filter((t) => t.source === 'user');
  if (!userThemes.length) {
    return [{ label: '（暂无用户主题）', enabled: false }];
  }
  return userThemes.map((t) => ({
    label: t.name,
    click: async () => {
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      const confirm = await dialog.showMessageBox(win || undefined, {
        type: 'warning',
        buttons: ['删除', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: '删除主题',
        message: `确定删除用户主题「${t.name}」？`,
        detail: '此操作不可撤销。',
      });
      if (confirm.response !== 0) return;
      try {
        if (currentThemeId() === t.id) setTheme('blackhole');
        themeImporter.removeUserTheme(themeLoader.getUserThemesDir(), t.id);
        rebuildTrayMenu();
      } catch (err) {
        await dialog.showMessageBox(win || undefined, {
          type: 'error',
          title: '删除失败',
          message: (err && err.message) || String(err),
        });
      }
    },
  }));
}

function skinMenuItems() {
  const active = currentThemeId();
  const themes = themeLoader.listThemes();
  const builtin = themes.filter((t) => t.source === 'builtin');
  const user = themes.filter((t) => t.source === 'user');

  const items = [];
  items.push({ label: '内置', enabled: false });
  for (const t of builtin) {
    items.push({
      label: (t.id === active ? '✓ ' : '   ') + t.name,
      click: () => setTheme(t.id),
    });
  }
  if (user.length) {
    items.push({ type: 'separator' });
    items.push({ label: '用户主题', enabled: false });
    for (const t of user) {
      items.push({
        label: (t.id === active ? '✓ ' : '   ') + t.name,
        click: () => setTheme(t.id),
      });
    }
  }
  items.push({ type: 'separator' });
  items.push({
    label: 'AI 设置（API Key）…',
    click: () => openAiSettingsWindow(),
  });
  items.push({
    label: '从图片生成主题…',
    click: () => createThemeFromImageDialog(),
  });
  items.push({
    label: '导入主题包（.zip）…',
    click: () => importThemeZipDialog(),
  });
  items.push({
    label: '打开主题文件夹…',
    click: () => themeLoader.openUserThemesFolder(),
  });
  items.push({
    label: '删除用户主题',
    submenu: deleteUserThemeMenuItems(),
  });
  return items;
}

function commonMenuTail() {
  const config = loadConfig();
  const bh = isBlackholeTheme(config.theme);
  const dnd = !!config.doNotDisturb;
  const inMini = getMini().getMiniMode();
  return [
    {
      label: inMini ? '退出迷你模式' : '迷你模式（靠边）',
      click: () => getMini().enterMiniViaMenu(),
    },
    {
      label: dnd ? '唤醒（退出勿扰）' : '睡眠 / 勿扰',
      click: () => setDoNotDisturb(!dnd),
    },
    {
      label: '移到显示器',
      submenu: displayMenuItems(),
    },
    {
      label: '刷新桌面扭曲',
      enabled: bh && !dnd,
      click: () => quietRefreshPlate(),
    },
    { type: 'separator' },
    {
      label: config.alwaysOnTop !== false ? '✓ 始终置顶' : '始终置顶',
      click: () => {
        const next = !(loadConfig().alwaysOnTop !== false);
        saveConfig({ alwaysOnTop: next });
        if (mainWindow) mainWindow.setAlwaysOnTop(next, 'screen-saver');
        rebuildTrayMenu();
      },
    },
    {
      label: config.openAtLogin ? '✓ 开机启动' : '开机启动',
      click: () => setOpenAtLogin(!loadConfig().openAtLogin),
    },
    {
      label: config.lowPowerIdle !== false ? '✓ 空闲省电' : '空闲省电',
      click: () => setLowPowerIdle(!(loadConfig().lowPowerIdle !== false)),
    },
    {
      label: config.clickThrough !== false ? '✓ 穿透透明区域' : '穿透透明区域',
      click: () => setClickThroughPref(!(loadConfig().clickThrough !== false)),
    },
    {
      // Off = blackhole excluded from capture (cleaner warp). On = EV/OBS can record pet.
      label: config.allowScreenCapture ? '✓ 录屏可见' : '录屏可见',
      click: () => setAllowScreenCapture(!loadConfig().allowScreenCapture),
    },
    {
      label: config.autoUpdateCheck !== false ? '✓ 自动检查更新' : '自动检查更新',
      click: () => getUpdater().setAutoUpdateCheck(!(loadConfig().autoUpdateCheck !== false)),
    },
    { type: 'separator' },
    {
      label: `版本 v${app.getVersion()}`,
      enabled: false,
    },
    getUpdater().getUpdateMenuItem(),
    { type: 'separator' },
    {
      label: '缩小到原尺寸',
      enabled: !inMini && clampPetSize(config.size || 360) > ensureBaseSize(config),
      click: () => {
        shrinkToBaseSize({ reason: 'manual' });
        rebuildTrayMenu();
      },
    },
    {
      label: '调整尺寸…',
      enabled: !inMini,
      click: () => openSizeSettingsWindow(),
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ];
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '显示 / 隐藏',
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isVisible()) mainWindow.hide();
          else mainWindow.show();
        },
      },
      { label: '皮肤', submenu: skinMenuItems() },
      ...commonMenuTail(),
    ])
  );
}

function registerIpc() {
  ipcMain.handle('get-media-activity', () => mediaPlayingNow());
  ipcMain.handle('get-typing-activity', () => {
    try {
      return !!keyboardActivity.isTyping?.();
    } catch (_) {
      return false;
    }
  });

  ipcMain.handle('get-config', () => {
    const cfg = loadConfig();
    const theme = themeLoader.loadTheme(cfg.theme || 'blackhole');
    // Never send API secrets to the pet renderer
    const { aiApiKey: _k, aiBaseUrl: _u, aiModel: _m, ...safe } = cfg;
    return {
      ...safe,
      themeMeta: {
        ...themeLoader.themePayload(theme),
        doNotDisturb: !!cfg.doNotDisturb,
        lowPowerIdle: cfg.lowPowerIdle !== false,
        clickThrough: cfg.clickThrough !== false,
      },
    };
  });

  ipcMain.handle('list-themes', () => themeLoader.listThemes());
  ipcMain.handle('open-themes-folder', () => themeLoader.openUserThemesFolder());
  ipcMain.handle('create-theme-from-image', async () => {
    await createThemeFromImageDialog();
    return themeLoader.listThemes();
  });
  ipcMain.handle('import-theme-zip', async () => {
    await importThemeZipDialog();
    return themeLoader.listThemes();
  });
  ipcMain.handle('ai-settings-get', () => getAiConfig());
  ipcMain.handle('ai-settings-save', (_e, payload) => {
    const apiKey = String(payload?.apiKey ?? '').trim();
    const baseUrl = normalizeBaseUrl(payload?.baseUrl || DEFAULT_BASE);
    const model = String(payload?.model ?? '').trim() || DEFAULT_MODEL;
    aiSecrets.setApiKey(apiKey);
    saveConfig({
      aiBaseUrl: baseUrl,
      aiModel: model,
    });
    return getAiConfig();
  });
  ipcMain.handle('ai-settings-test', async (_e, payload) => {
    const current = getAiConfig();
    const apiKey = String(payload?.apiKey ?? current.apiKey ?? '').trim();
    const baseUrl = normalizeBaseUrl(payload?.baseUrl || current.baseUrl || DEFAULT_BASE);
    const model = String(payload?.model ?? current.model ?? '').trim() || DEFAULT_MODEL;
    return testAiConnection({ apiKey, baseUrl, model });
  });
  ipcMain.on('ai-settings-close', () => {
    if (aiSettingsWin && !aiSettingsWin.isDestroyed()) aiSettingsWin.close();
  });

  ipcMain.handle('size-settings-get', () => loadConfig().size || 360);
  ipcMain.handle('size-settings-apply', (_e, size) => {
    stopSizeAnim();
    setWindowSize(size, { updateBase: true, anchor: 'center' });
    return loadConfig().size;
  });
  ipcMain.on('size-settings-close', () => {
    if (sizeSettingsWin && !sizeSettingsWin.isDestroyed()) sizeSettingsWin.close();
  });

  ipcMain.handle('set-size', (_e, size) => {
    stopSizeAnim();
    setWindowSize(size, { updateBase: true, anchor: 'center' });
    return loadConfig().size;
  });

  ipcMain.handle('shrink-to-base', () => {
    const did = shrinkToBaseSize({ reason: 'manual' });
    rebuildTrayMenu();
    return { ok: did, size: loadConfig().size, baseSize: ensureBaseSize() };
  });

  ipcMain.handle('set-theme', (_e, theme) => {
    setTheme(theme);
    return loadConfig().theme;
  });

  ipcMain.on('set-ignore-mouse', (_e, ignore) => {
    // Never re-enable click-through while dragging/resizing
    if (ignore && (userDragging || userResizing)) return;
    setClickThroughEnabled(!!ignore);
  });

  ipcMain.on('note-activity', () => noteActivity());

  ipcMain.on('drag-start', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
    userDragging = true;
    isMoving = true;
    noteActivity();
    clearTimeout(moveCropTimer);
    setClickThroughEnabled(false);
    // Freeze pixel size from config — Windows transparent windows grow if setPosition is used alone
    const dims = boundsForSize(lockedSize(), currentThemeId(), 0, 0);
    dragLockSize = { width: dims.width, height: dims.height };
    const b = mainWindow.getBounds();
    applyClampedBounds(b.x, b.y, dragLockSize.width, dragLockSize.height);
    // Absolute grab offset avoids DPI drift from renderer screenX deltas
    const after = mainWindow.getBounds();
    const point = screen.getCursorScreenPoint();
    dragGrabOffset = { x: point.x - after.x, y: point.y - after.y };
    startDragFollow();
    try {
      const cfg = loadConfig();
      if (cfg.alwaysOnTop !== false) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    } catch (_) {}
  });

  ipcMain.on('drag-move', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (getMini().getMiniMode() || getMini().getMiniTransitioning()) return;
    userDragging = true;
    isMoving = true;
    noteActivity();
    clearTimeout(moveCropTimer);
    setClickThroughEnabled(false);
    if (!dragLockSize) {
      const dims = boundsForSize(lockedSize(), currentThemeId(), 0, 0);
      dragLockSize = { width: dims.width, height: dims.height };
    }
    const point = screen.getCursorScreenPoint();
    if (!dragGrabOffset) {
      const b = mainWindow.getBounds();
      dragGrabOffset = { x: point.x - b.x, y: point.y - b.y };
    }
    if (!dragFollowTimer) startDragFollow();
    followDragCursor();
  });

  ipcMain.on('drag-end', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    stopDragFollow();
    userDragging = false;
    isMoving = false;
    dragLockSize = null;
    dragGrabOffset = null;
    if (!getMini().getMiniMode() && !getMini().getMiniTransitioning()) {
      const snapped = getMini().checkMiniModeSnap();
      if (!snapped) {
        enforceLockedSize();
        saveThemePosition();
      }
    }
    // Do NOT force click-through here — cursor is often still over the pet.
    // Renderer syncs ignore-mouse from :hover after pointer-up.
    scheduleCropAfterMove();
  });

  ipcMain.on('exit-mini-mode', () => {
    getMini().exitMiniMode();
  });

  ipcMain.handle('exit-mini-mode-immediate', () => {
    return !!getMini().exitMiniModeImmediate();
  });

  ipcMain.on('mini-peek-in', () => {
    getMini().miniPeekIn();
  });

  ipcMain.on('mini-peek-out', () => {
    getMini().miniPeekOut();
  });

  ipcMain.on('toggle-mini-mode', () => {
    getMini().enterMiniViaMenu();
  });

  ipcMain.handle('recycle-paths', async (_e, paths) => {
    noteActivity();
    capturePaused = true;
    try {
      const result = await recyclePaths(paths);
      const ok = (result?.results || []).filter((r) => r.ok).length;
      if (ok > 0) {
        recycleBinWatcher?.markFed?.();
        // Grow after suck FX; refresh plate after grow so capture doesn't shove the window
        setTimeout(() => {
          growFromFeed(ok);
          rebuildTrayMenu();
        }, 420);
        setTimeout(() => {
          recycleBinWatcher?.refresh?.();
        }, 700);
      }
      return result;
    } finally {
      setTimeout(() => {
        capturePaused = false;
        // Wait until grow anim has started/settled before recapturing the desk
        if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
          setTimeout(() => quietRefreshPlate(), 520);
        }
      }, 280);
    }
  });

  ipcMain.handle('get-recycle-bin-count', async () => {
    try {
      const { queryRecycleCount } = require('./recycle-bin-watch');
      return await queryRecycleCount();
    } catch (_) {
      return -1;
    }
  });

  ipcMain.handle('show-context-menu', () => {
    const inMini = getMini().getMiniMode();
    const cfg = loadConfig();
    const canShrink = !inMini && clampPetSize(cfg.size || 360) > ensureBaseSize(cfg);
    const menu = Menu.buildFromTemplate([
      {
        label: '缩小到原尺寸',
        enabled: canShrink,
        click: () => {
          shrinkToBaseSize({ reason: 'manual' });
          rebuildTrayMenu();
        },
      },
      {
        label: '调整尺寸…',
        enabled: !inMini,
        click: () => openSizeSettingsWindow(),
      },
      { type: 'separator' },
      { label: '皮肤', submenu: skinMenuItems() },
      ...commonMenuTail(),
    ]);
    if (mainWindow) menu.popup({ window: mainWindow });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const userData = app.getPath('userData');
    aiSecrets.init(userData);
    themeLoader.init(__dirname, userData);

    // Migrate legacy plaintext key from config.json → encrypted ai-secrets.json
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (aiSecrets.migrateFromConfig(raw) && raw.aiApiKey) {
          const { aiApiKey: _drop, ...rest } = raw;
          fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...DEFAULT_CONFIG, ...rest }, null, 2));
        }
      }
    } catch (_) {}

    const cfg = loadConfig();
    const known = themeLoader.discoverThemes();
    if (!cfg.theme || !known.has(cfg.theme)) {
      saveConfig({ theme: 'blackhole' });
    }

    // After an update, don't restore edge-docked mini — users reported being
    // stuck unable to drag at the pre-update spot. They can dock again anytime.
    let skipMiniRestore = false;
    try {
      const pkgVer = require('./package.json').version;
      if (cfg.lastLaunchedVersion !== pkgVer) {
        skipMiniRestore = !!cfg.miniMode;
        const patch = { lastLaunchedVersion: pkgVer, miniMode: false };
        if (skipMiniRestore && Number.isFinite(cfg.preMiniX) && Number.isFinite(cfg.preMiniY)) {
          patch.x = cfg.preMiniX;
          patch.y = cfg.preMiniY;
          const themePositions = { ...(cfg.themePositions || {}) };
          const tid = cfg.theme || 'blackhole';
          themePositions[tid] = {
            ...(themePositions[tid] || {}),
            x: cfg.preMiniX,
            y: cfg.preMiniY,
          };
          patch.themePositions = themePositions;
        }
        saveConfig(patch);
      }
    } catch (_) {}

    hydrateOpenAtLogin();
    registerIpc();
    createWindow();
    createTray();
    ensureBaseSize();
    startRecycleBinWatcher();
    syncTypingKeyboardMonitor();

    try {
      const m = getMini();
      m.refreshTheme(themeLoader.loadTheme(currentThemeId()));
      const cfg0 = loadConfig();
      if (cfg0.miniMode && !skipMiniRestore) {
        setTimeout(() => {
          m.restoreFromPrefs(cfg0);
          rebuildTrayMenu();
        }, 400);
      }
    } catch (err) {
      console.warn('[mini] init failed', err);
    }

    // Ensure the window is interactive shortly after launch (update restart)
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        setClickThroughEnabled(false);
        mainWindow.webContents.send('click-through-wake');
      } catch (_) {}
      setTimeout(() => syncClickThroughFromCursor(), 200);
    }, 500);

    try {
      getUpdater().setupAutoUpdater();
      getUpdater().startScheduler();
    } catch (err) {
      console.warn('[updater] init failed', err);
    }

    screen.on('display-added', () => rebuildTrayMenu());
    screen.on('display-removed', () => {
      if (getMini().getMiniMode()) getMini().exitMiniMode();
      if (mainWindow && !mainWindow.isDestroyed()) {
        const [x, y] = mainWindow.getPosition();
        const [w, h] = mainWindow.getSize();
        applyClampedBounds(x, y, w, h);
        saveThemePosition();
      }
      rebuildTrayMenu();
    });
    screen.on('display-metrics-changed', () => {
      if (getMini().getMiniMode()) getMini().handleDisplayChange();
    });
  });

  app.on('window-all-closed', (e) => e.preventDefault());

  app.on('before-quit', () => {
    try {
      recycleBinWatcher?.stop?.();
    } catch (_) {}
    try {
      stopSizeAnim();
    } catch (_) {}
    try {
      keyboardActivity.stop();
      mediaActivity.stop();
    } catch (_) {}
    try {
      getUpdater().stopScheduler();
    } catch (_) {}
    stopCropLoop();
    if (mainWindow) {
      // If docked, persist the pre-mini place as the real position so a restart
      // / update doesn't reopen half off-screen and feel "stuck".
      try {
        if (getMini().getMiniMode()) {
          const cfg = loadConfig();
          const x = Number(cfg.preMiniX);
          const y = Number(cfg.preMiniY);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            const [w, h] = mainWindow.getSize();
            const pos = clampToDisplays(screen, x, y, w, h);
            const id = currentThemeId();
            const themePositions = { ...(cfg.themePositions || {}) };
            themePositions[id] = {
              ...(themePositions[id] || {}),
              x: pos.x,
              y: pos.y,
            };
            saveConfig({ x: pos.x, y: pos.y, themePositions });
          }
        } else {
          saveThemePosition();
        }
      } catch (_) {
        saveThemePosition();
      }
      saveConfig({ size: lockedSize() });
    }
  });
}
