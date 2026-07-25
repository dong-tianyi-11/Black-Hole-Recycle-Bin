const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sizeSettings', {
  get: () => ipcRenderer.invoke('size-settings-get'),
  apply: (size) => ipcRenderer.invoke('size-settings-apply', size),
  close: () => ipcRenderer.send('size-settings-close'),
});
