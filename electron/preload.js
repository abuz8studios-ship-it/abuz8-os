// ABUZ8 OS · Electron preload — narrow bridge to main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('abuz8', {
  platform: () => ipcRenderer.invoke('abuz8:platform'),
  isElectron: true
});
