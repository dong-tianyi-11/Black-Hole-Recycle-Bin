const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('blackHole', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  listThemes: () => ipcRenderer.invoke('list-themes'),
  openThemesFolder: () => ipcRenderer.invoke('open-themes-folder'),
  importThemeZip: () => ipcRenderer.invoke('import-theme-zip'),
  setSize: (size) => ipcRenderer.invoke('set-size', size),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', !!ignore),
  noteActivity: () => ipcRenderer.send('note-activity'),
  onSizeChanged: (cb) => {
    const handler = (_e, size) => cb(size);
    ipcRenderer.on('size-changed', handler);
    return () => ipcRenderer.removeListener('size-changed', handler);
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
  showContextMenu: () => ipcRenderer.invoke('show-context-menu'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: (dx, dy) => ipcRenderer.send('drag-move', { dx, dy }),
  dragEnd: () => ipcRenderer.send('drag-end'),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return file.path || '';
    }
  },
});
