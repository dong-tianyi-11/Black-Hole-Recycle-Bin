const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aiSettings', {
  get: () => ipcRenderer.invoke('ai-settings-get'),
  save: (payload) => ipcRenderer.invoke('ai-settings-save', payload),
  test: (payload) => ipcRenderer.invoke('ai-settings-test', payload),
  close: () => ipcRenderer.send('ai-settings-close'),
});
