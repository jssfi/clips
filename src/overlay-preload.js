const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clipsOverlay', {
  onShow: callback => ipcRenderer.on('toast:show', (_event, toast) => callback(toast)),
  onHide: callback => ipcRenderer.on('toast:hide', callback)
});
