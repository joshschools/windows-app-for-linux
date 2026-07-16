const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (updates) => ipcRenderer.invoke('settings:save', updates),
  clearSession: () => ipcRenderer.invoke('settings:clear-session'),
});
