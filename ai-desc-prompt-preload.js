const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('descPrompt', {
  submit: (text) => ipcRenderer.send('ai-desc-submit', text),
  cancel: () => ipcRenderer.send('ai-desc-cancel'),
});
