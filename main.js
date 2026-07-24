const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { recyclePaths } = require('./recycle');
const {
  refreshDesktopPlate,
  refreshPlateHidden,
  cropPlateForWindow,
  hasPlate,
} = require('./capture');
const themeLoader = require('./theme-loader');
const themeImporter = require('./theme-importer');
const {
  getDisplaysSafe,
  clampToDisplays,
  centerOnWorkArea,
  findDisplayById,
  displaySnapshot,
  primaryWorkArea,
} = require('./screen-clamp');
const { createUpdater } = require('./updater');

app.setPath('userData', path.join(app.getPath('appData'), 'black-hole-recycle-bin'));

if (process.platform === 'win32') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

const DEFAULT_CONFIG = {
  size: 360,
  x: null,
  y: null,
  alwaysOnTop: true,
  theme: 'blackhole',
  openAtLogin: false,
  doNotDisturb: false,
  lowPowerIdle: true,
  clickThrough: true,
  themePositions: {},
  autoUpdateCheck: true,
};

let mainWindow = null;
let tray = null;
let cropTimer = null;
let moveCropTimer = null;
let capturePaused = false;
let isMoving = false;
let userDragging = false;
let userResizing = false;
let dragLockSize = null; // { width, height } frozen for the whole drag
let allowPulseResize = false;
let lastActiveAt = Date.now();
let mousePassthrough = true;

let updater = null;

function getUpdater() {
  if (!updater) {
    updater = createUpdater({
      getConfig: loadConfig,
      saveConfig,
      rebuildMenus: () => rebuildTrayMenu(),
      getParentWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    });
  }
  return updater;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(partial) {
  const next = { ...loadConfig(), ...partial };
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

function isBlackholeTheme(themeId) {
  const t = themeLoader.loadTheme(themeId || currentThemeId());
  return !t || t.type === 'blackhole';
}

function themeAspect(themeId) {
  const t = themeLoader.loadTheme(themeId || currentThemeId());
  if (!t || t.type === 'blackhole') return 1;
  return t.aspect > 0 ? t.aspect : 200 / 266;
}

function boundsForSize(size, themeId, cx, cy) {
  const scale = isBlackholeTheme(themeId) ? 1.15 : 1;
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
  const pos = clampToDisplays(screen, x, y, w, h);
  mainWindow.setBounds({ x: pos.x, y: pos.y, width: w, height: h });
  return pos;
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
  const cfg = loadConfig();
  const s = lockedSize();
  const theme = cfg.theme || 'blackhole';
  const [x, y] = mainWindow.getPosition();
  const [cw, ch] = mainWindow.getSize();
  const target = boundsForSize(s, theme, x + cw / 2, y + ch / 2);
  if (cw !== target.width || ch !== target.height) {
    applyClampedBounds(x, y, target.width, target.height);
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

function pushCropFrame() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
  if (!isBlackholeTheme()) return;
  if (loadConfig().doNotDisturb) return;
  if (!hasPlate()) return;
  const frame = cropPlateForWindow(mainWindow);
  if (frame) {
    mainWindow.webContents.send('desktop-frame', {
      data: frame.data,
      padRatio: frame.padRatio,
      mime: frame.mime || 'image/jpeg',
    });
  }
}

function cropIntervalMs() {
  const cfg = loadConfig();
  if (cfg.doNotDisturb) return 2000;
  if (cfg.lowPowerIdle !== false && Date.now() - lastActiveAt > 25000) return 900;
  return 140;
}

function scheduleCropAfterMove() {
  // Never hide-capture while the user is dragging or resizing
  if (userDragging || userResizing) return;
  clearTimeout(moveCropTimer);
  moveCropTimer = setTimeout(() => {
    if (userDragging || userResizing) return;
    isMoving = false;
    enforceLockedSize();
    if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
      quietRefreshPlate();
    } else {
      pushCropFrame();
    }
  }, 280);
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
      pushCropFrame();
    }
    cropTimer = setTimeout(tick, cropIntervalMs());
  };
  cropTimer = setTimeout(tick, 80);
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
    await refreshPlateHidden(mainWindow);
    pushCropFrame();
  } finally {
    capturePaused = false;
  }
}

function setWindowSize(size) {
  if (!mainWindow) return;
  if (userDragging) return; // don't fight an active drag
  noteActivity();
  const clamped = Math.round(Math.max(160, Math.min(720, size)));
  const theme = currentThemeId();
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const next = boundsForSize(clamped, theme, x + w / 2, y + h / 2);

  userResizing = true;
  isMoving = true;
  clearTimeout(moveCropTimer);
  try {
    const pos = applyClampedBounds(next.x, next.y, next.width, next.height);
    saveConfig({ size: clamped, x: pos.x, y: pos.y });
    saveThemePosition(theme);
    mainWindow.webContents.send('size-changed', clamped);
    // Soft update only — never hide window mid-resize
    pushCropFrame();
  } finally {
    setTimeout(() => {
      userResizing = false;
      isMoving = false;
      // Deferred full plate refresh after size settles
      if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
        scheduleCropAfterMove();
      }
    }, 120);
  }
}

function setTheme(themeId) {
  const theme = themeLoader.loadTheme(themeId);
  if (!theme) return;
  noteActivity();
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveThemePosition(currentThemeId());
  }

  saveConfig({ theme: theme.id });
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const next = restoreThemePosition(theme.id, lockedSize());
  applyClampedBounds(next.x, next.y, next.width, next.height);
  saveThemePosition(theme.id);

  sendThemePayload(theme.id);

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
    mainWindow.on('focus', forceRedraw);
    mainWindow.on('blur', forceRedraw);
  } else {
    mainWindow.on('focus', keepBlankTitle);
    mainWindow.on('show', keepBlankTitle);
  }

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', async () => {
    if (isBlackholeTheme() && !loadConfig().doNotDisturb) {
      const disp = screen.getDisplayMatching(mainWindow.getBounds());
      await refreshDesktopPlate(disp);
    }
    mainWindow.show();
    setClickThroughEnabled(true);
    sendThemePayload();
    if (loadConfig().doNotDisturb) {
      mainWindow.webContents.send('dnd-changed', true);
    }
    pushCropFrame();
    if (isBlackholeTheme() && !loadConfig().doNotDisturb) startCropLoop();
  });

  mainWindow.on('will-move', () => {
    isMoving = true;
  });

  mainWindow.on('moved', () => {
    if (!mainWindow) return;
    isMoving = true;
    // Active user drag already clamps + will save on drag-end
    if (userDragging || userResizing) return;
    noteActivity();
    const [wx, wy] = mainWindow.getPosition();
    const pos = clampMainWindow(wx, wy);
    if (pos.x !== wx || pos.y !== wy) {
      mainWindow.setPosition(pos.x, pos.y);
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
    await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: '导入成功',
      message: `已导入主题「${imported.name}」`,
      detail: `id: ${imported.themeId}\n可在皮肤菜单中切换。`,
    });
    rebuildTrayMenu();
  } else {
    await dialog.showMessageBox(win || undefined, {
      type: 'error',
      title: '导入失败',
      message: '导入主题包失败',
      detail: imported.message || '未知错误',
    });
  }
}

async function createThemeFromTemplate() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const themeId = `my-theme-${stamp}`;
  const confirm = await dialog.showMessageBox(win || undefined, {
    type: 'question',
    buttons: ['创建并打开文件夹', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '从模板新建主题',
    message: '用内置模板创建一个新的用户主题？',
    detail: `将创建文件夹：${themeId}\n请编辑其中的 theme.json 与 assets/，然后点「刷新主题」。`,
  });
  if (confirm.response !== 0) return;
  try {
    const templateSrc = path.join(__dirname, 'themes', 'template');
    const created = themeImporter.createThemeScaffold(
      themeLoader.getUserThemesDir(),
      templateSrc,
      themeId,
      { name: '我的主题' }
    );
    await themeLoader.openUserThemesFolder();
    await dialog.showMessageBox(win || undefined, {
      type: 'info',
      title: '已创建',
      message: `已创建主题「${created.name}」`,
      detail: created.path,
    });
    rebuildTrayMenu();
  } catch (err) {
    await dialog.showMessageBox(win || undefined, {
      type: 'error',
      title: '创建失败',
      message: (err && err.message) || String(err),
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
    label: '导入主题包（.zip）…',
    click: () => importThemeZipDialog(),
  });
  items.push({
    label: '从模板新建主题…',
    click: () => createThemeFromTemplate(),
  });
  items.push({
    label: '打开主题文件夹…',
    click: () => themeLoader.openUserThemesFolder(),
  });
  items.push({
    label: '刷新主题',
    click: () => rebuildTrayMenu(),
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
  return [
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
      label: config.autoUpdateCheck !== false ? '✓ 自动检查更新' : '自动检查更新',
      click: () => getUpdater().setAutoUpdateCheck(!(loadConfig().autoUpdateCheck !== false)),
    },
    { type: 'separator' },
    getUpdater().getUpdateMenuItem(),
    { type: 'separator' },
    {
      label: '尺寸',
      submenu: [
        { label: '小 (180)', click: () => setWindowSize(180) },
        { label: '中 (360)', click: () => setWindowSize(360) },
        { label: '大 (480)', click: () => setWindowSize(480) },
        { label: '超大 (600)', click: () => setWindowSize(600) },
      ],
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
  ipcMain.handle('get-config', () => {
    const cfg = loadConfig();
    const theme = themeLoader.loadTheme(cfg.theme || 'blackhole');
    return {
      ...cfg,
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
  ipcMain.handle('import-theme-zip', async () => {
    await importThemeZipDialog();
    return themeLoader.listThemes();
  });

  ipcMain.handle('set-size', (_e, size) => {
    setWindowSize(size);
    return loadConfig().size;
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
    try {
      const cfg = loadConfig();
      if (cfg.alwaysOnTop !== false) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    } catch (_) {}
  });

  ipcMain.on('drag-move', (_e, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    userDragging = true;
    isMoving = true;
    noteActivity();
    clearTimeout(moveCropTimer);
    setClickThroughEnabled(false);
    if (!dragLockSize) {
      const dims = boundsForSize(lockedSize(), currentThemeId(), 0, 0);
      dragLockSize = { width: dims.width, height: dims.height };
    }
    const b = mainWindow.getBounds();
    applyClampedBounds(b.x + dx, b.y + dy, dragLockSize.width, dragLockSize.height);
  });

  ipcMain.on('drag-end', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    userDragging = false;
    isMoving = false;
    dragLockSize = null;
    enforceLockedSize();
    saveThemePosition();
    // Do NOT force click-through here — cursor is often still over the pet.
    // Renderer syncs ignore-mouse from :hover after pointer-up.
    scheduleCropAfterMove();
  });

  ipcMain.handle('recycle-paths', async (_e, paths) => {
    noteActivity();
    capturePaused = true;
    try {
      return await recyclePaths(paths);
    } finally {
      setTimeout(() => {
        capturePaused = false;
        if (isBlackholeTheme() && !loadConfig().doNotDisturb) quietRefreshPlate();
      }, 400);
    }
  });

  ipcMain.handle('show-context-menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '缩小', click: () => setWindowSize((loadConfig().size || 360) * 0.85) },
      { label: '放大', click: () => setWindowSize((loadConfig().size || 360) * 1.15) },
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
    themeLoader.init(__dirname, app.getPath('userData'));
    const cfg = loadConfig();
    const known = themeLoader.discoverThemes();
    if (!cfg.theme || !known.has(cfg.theme)) {
      saveConfig({ theme: 'blackhole' });
    }
    hydrateOpenAtLogin();
    registerIpc();
    createWindow();
    createTray();

    try {
      getUpdater().setupAutoUpdater();
      getUpdater().startScheduler();
    } catch (err) {
      console.warn('[updater] init failed', err);
    }

    screen.on('display-added', () => rebuildTrayMenu());
    screen.on('display-removed', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const [x, y] = mainWindow.getPosition();
        const [w, h] = mainWindow.getSize();
        applyClampedBounds(x, y, w, h);
        saveThemePosition();
      }
      rebuildTrayMenu();
    });
  });

  app.on('window-all-closed', (e) => e.preventDefault());

  app.on('before-quit', () => {
    try {
      getUpdater().stopScheduler();
    } catch (_) {}
    stopCropLoop();
    if (mainWindow) {
      saveThemePosition();
      saveConfig({ size: lockedSize() });
    }
  });
}
