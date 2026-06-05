// Preload for the Settings window. Shipped as a static file (it used to be
// written to userData at runtime on every open, which was an unnecessary
// tampering surface). Exposes a minimal, whitelisted IPC bridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    const validChannels = ['save-settings', 'clear-cache'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  }
});
