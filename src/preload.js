const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('error', event => {
  ipcRenderer.send('renderer:log', 'error', `${event.message} (${event.filename}:${event.lineno})`);
});
window.addEventListener('unhandledrejection', event => {
  ipcRenderer.send('renderer:log', 'error', event.reason?.stack || event.reason?.message || String(event.reason));
});
window.addEventListener('DOMContentLoaded', () => {
  const microphoneVolume = document.getElementById('microphone-volume');
  const applyMicrophoneVolume = () => {
    ipcRenderer.send('capture:microphone-volume-set', Number(microphoneVolume.value));
  };
  microphoneVolume?.addEventListener('input', applyMicrophoneVolume);
  microphoneVolume?.addEventListener('change', applyMicrophoneVolume);
  const microphoneNoiseGate = document.getElementById('microphone-noise-gate');
  const applyMicrophoneNoiseGate = () => ipcRenderer.send('capture:microphone-noise-gate-set', Number(microphoneNoiseGate.value));
  microphoneNoiseGate?.addEventListener('input', applyMicrophoneNoiseGate);
  microphoneNoiseGate?.addEventListener('change', applyMicrophoneNoiseGate);
  document.getElementById('microphone-nvidia-noise-removal')?.addEventListener('change', event => {
    ipcRenderer.send('capture:microphone-nvidia-noise-removal-set', event.currentTarget.checked);
  });
});

contextBridge.exposeInMainWorld('clips', {
  getState: () => ipcRenderer.invoke('state:get'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  beginHotkeyCapture: () => ipcRenderer.invoke('hotkey:capture-start'),
  cancelHotkeyCapture: () => ipcRenderer.invoke('hotkey:capture-cancel'),
  connect: () => ipcRenderer.invoke('capture:connect'),
  toggleRecording: () => ipcRenderer.invoke('recording:toggle'),
  saveClip: () => ipcRenderer.invoke('clip:save'),
  openFolder: () => ipcRenderer.invoke('folder:open'),
  openLibraryFolder: () => ipcRenderer.invoke('folder:open-root'),
  openRecording: (filePath) => ipcRenderer.invoke('recording:open', filePath),
  getRecordingThumbnail: (filePath) => ipcRenderer.invoke('recording:thumbnail', filePath),
  setRecordingFavorite: (filePath, favorite) => ipcRenderer.invoke('recording:favorite', filePath, favorite),
  deleteRecordings: (filePaths) => ipcRenderer.invoke('recording:delete', filePaths),
  startMpv: (filePath, bounds) => ipcRenderer.invoke('mpv:start', filePath, bounds),
  setMpvBounds: (bounds) => ipcRenderer.invoke('mpv:bounds', bounds),
  mpvStatus: () => ipcRenderer.invoke('mpv:status'),
  seekMpv: (seconds) => ipcRenderer.invoke('mpv:seek', seconds),
  toggleMpv: () => ipcRenderer.invoke('mpv:toggle'),
  pauseMpv: (paused) => ipcRenderer.invoke('mpv:pause', paused),
  setMpvVolume: (volume) => ipcRenderer.invoke('mpv:volume', volume),
  setMpvAudioMix: (adjustments) => ipcRenderer.invoke('mpv:audio-mix', adjustments),
  closeMpv: () => ipcRenderer.invoke('mpv:close'),
  openMpvFullscreen: (filePath) => ipcRenderer.invoke('mpv:fullscreen', filePath),
  listMicrophones: () => ipcRenderer.invoke('capture:microphones'),
  microphoneLevel: () => ipcRenderer.invoke('capture:microphone-level'),
  setModalAppearance: (active) => ipcRenderer.invoke('window:modal-appearance', active),
  onTrimProgress: (callback) => ipcRenderer.on('trim:progress', (_event, progress) => callback(progress)),
  onMpvFrame: (callback) => ipcRenderer.on('mpv:frame', (_event, frame) => callback(frame)),
  trimRecording: (filePath, startSeconds, endSeconds, bitrate) => ipcRenderer.invoke('recording:trim', filePath, startSeconds, endSeconds, bitrate),
  getAudioTracks: (filePath) => ipcRenderer.invoke('recording:audio-tracks', filePath),
  mixRecordingAudio: (filePath, adjustments, replace) => ipcRenderer.invoke('recording:audio-mix', filePath, adjustments, replace),
  onAudioMixProgress: (callback) => ipcRenderer.on('audio:mix-progress', (_event, progress) => callback(progress)),
  uploadRecording: (filePath) => ipcRenderer.invoke('recording:upload', filePath),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  listProcesses: () => ipcRenderer.invoke('processes:list'),
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state))
});
