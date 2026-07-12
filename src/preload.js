const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clippy', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  connect: () => ipcRenderer.invoke('obs:connect'),
  toggleRecording: () => ipcRenderer.invoke('recording:toggle'),
  saveClip: () => ipcRenderer.invoke('clip:save'),
  openObs: () => ipcRenderer.invoke('obs:open'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  openRecording: (filePath) => ipcRenderer.invoke('recording:open', filePath),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  listProcesses: () => ipcRenderer.invoke('processes:list'),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state))
});
