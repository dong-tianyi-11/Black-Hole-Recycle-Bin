const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('blackHole', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  listThemes: () => ipcRenderer.invoke('list-themes'),
  openThemesFolder: () => ipcRenderer.invoke('open-themes-folder'),
  createThemeFromImage: () => ipcRenderer.invoke('create-theme-from-image'),
  importThemeZip: () => ipcRenderer.invoke('import-theme-zip'),
  setSize: (size) => ipcRenderer.invoke('set-size', size),
  shrinkToBase: () => ipcRenderer.invoke('shrink-to-base'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', !!ignore),
  noteActivity: () => ipcRenderer.send('note-activity'),
  onSizeChanged: (cb) => {
    const handler = (_e, size) => cb(size);
    ipcRenderer.on('size-changed', handler);
    return () => ipcRenderer.removeListener('size-changed', handler);
  },
  onPetGrown: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('pet-grown', handler);
    return () => ipcRenderer.removeListener('pet-grown', handler);
  },
  onPetShrunk: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('pet-shrunk', handler);
    return () => ipcRenderer.removeListener('pet-shrunk', handler);
  },
  onThemeChanged: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('theme-changed', handler);
    return () => ipcRenderer.removeListener('theme-changed', handler);
  },
  onDesktopFrame: (cb) => {
    const handler = (_e, frame) => cb(frame);
    ipcRenderer.on('desktop-frame', handler);
    return () => ipcRenderer.removeListener('desktop-frame', handler);
  },
  onDndChanged: (cb) => {
    const handler = (_e, on) => cb(!!on);
    ipcRenderer.on('dnd-changed', handler);
    return () => ipcRenderer.removeListener('dnd-changed', handler);
  },
  onLowPowerChanged: (cb) => {
    const handler = (_e, on) => cb(!!on);
    ipcRenderer.on('low-power-changed', handler);
    return () => ipcRenderer.removeListener('low-power-changed', handler);
  },
  recyclePaths: (paths) => ipcRenderer.invoke('recycle-paths', paths),
  getRecycleBinCount: () => ipcRenderer.invoke('get-recycle-bin-count'),
  onRecycleBinCount: (cb) => {
    const handler = (_e, n) => cb(n);
    ipcRenderer.on('recycle-bin-count', handler);
    return () => ipcRenderer.removeListener('recycle-bin-count', handler);
  },
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  exitMiniMode: () => ipcRenderer.send('exit-mini-mode'),
  exitMiniModeImmediate: () => ipcRenderer.invoke('exit-mini-mode-immediate'),
  miniPeekIn: () => ipcRenderer.send('mini-peek-in'),
  miniPeekOut: () => ipcRenderer.send('mini-peek-out'),
  toggleMiniMode: () => ipcRenderer.send('toggle-mini-mode'),
  onMiniModeChange: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('mini-mode-change', handler);
    return () => ipcRenderer.removeListener('mini-mode-change', handler);
  },
  onMiniPetState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('mini-pet-state', handler);
    return () => ipcRenderer.removeListener('mini-pet-state', handler);
  },
  onMiniExited: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('mini-exited', handler);
    return () => ipcRenderer.removeListener('mini-exited', handler);
  },
  onMiniPeek: (cb) => {
    const handler = (_e, peeking) => cb(!!peeking);
    ipcRenderer.on('mini-peek', handler);
    return () => ipcRenderer.removeListener('mini-peek', handler);
  },
  onClickThroughWake: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('click-through-wake', handler);
    return () => ipcRenderer.removeListener('click-through-wake', handler);
  },
  onTypingActivity: (cb) => {
    const handler = (_e, on) => cb(!!on);
    ipcRenderer.on('typing-activity', handler);
    return () => ipcRenderer.removeListener('typing-activity', handler);
  },
  getMediaActivity: () => ipcRenderer.invoke('get-media-activity'),
  getTypingActivity: () => ipcRenderer.invoke('get-typing-activity'),
  onMediaActivity: (cb) => {
    const handler = (_e, on) => cb(!!on);
    ipcRenderer.on('media-activity', handler);
    return () => ipcRenderer.removeListener('media-activity', handler);
  },
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file.path || '';
    }
  },
});
