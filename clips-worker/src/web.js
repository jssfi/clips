(() => {
  const now = Date.now();
  const callbacks = { state: [], trim: [], frame: [], mix: [] };
  const clone = value => structuredClone(value);
  const recording = (name, minutesAgo, bytes, kind = 'replay', favorite = false, day) => ({
    path: `demo://${name}`,
    name,
    modified: now - minutesAgo * 60_000,
    bytes,
    kind,
    favorite,
    ...(day ? { day } : {})
  });
  const state = {
    settings: {
      recordingsFolder: 'C:\\Users\\You\\Videos\\Clips',
      retentionDays: 14,
      storageCleanupMode: 'disk',
      maxDiskUsagePercent: 80,
      maxRawRecordingGigabytes: 250,
      gameExecutables: ['VALORANT-Win64-Shipping.exe', 'Minecraft.exe'],
      audioExecutables: ['Discord.exe'],
      autoRecord: true,
      startWithWindows: true,
      clipHotkey: 'CommandOrControl+Shift+F10',
      stopDelaySeconds: 20,
      clipLengthSeconds: 60,
      obsRecordingQuality: 'HQ',
      obsResolution: '1920x1080',
      obsFps: 60,
      obsFormat: 'mkv',
      microphoneDeviceId: 'disabled',
      microphoneVolumePercent: 100,
      microphoneNoiseGateDb: -40,
      microphoneNvidiaNoiseRemoval: true,
      trimBitrate: 'original',
      nightlyUpdates: false,
      telemetryMode: 'off'
    },
    obs: { connected: true, recording: false },
    activeGames: [],
    autoRecordSuppressed: false,
    recordings: [
      recording('ace-on-sunset.mkv', 8, 148_897_792, 'replay', true),
      recording('last-second-clutch.mkv', 24, 112_197_632),
      recording('ranked-session.mkv', 42, 2_684_354_560, 'recording')
    ],
    archivedRecordings: [
      recording('three-piece.mkv', 1_480, 96_468_992, 'replay', false, '2026-08-09'),
      recording('weekend-session.mkv', 2_910, 1_932_735_283, 'recording', false, '2026-08-08')
    ],
    lastError: '',
    lastClip: null,
    captureEngineInstalled: true,
    app: { version: 'web demo', buildTime: new Date().toISOString(), runtimeVersion: 'desktop only', runtimeReady: true, changelog: [] },
    telemetry: { configured: false, mode: 'off' },
    update: { status: 'idle', configured: false }
  };

  const emit = () => callbacks.state.forEach(callback => callback(clone(state)));
  const desktopOnly = async feature => { throw new Error(`${feature} is available in the Windows app.`); };
  const fetchState = async () => {
    if (!state.app.changelog.length) {
      try { state.app.changelog = await fetch('changelog.json').then(response => response.json()); } catch { /* Demo still works offline. */ }
    }
    return clone(state);
  };
  const setFavorite = async (filePath, favorite) => {
    [...state.recordings, ...state.archivedRecordings].forEach(item => {
      if (item.path === filePath) item.favorite = favorite;
    });
    emit();
    return clone(state);
  };

  window.clips = {
    getState: fetchState,
    installUpdate: () => desktopOnly('Installing updates'),
    checkForUpdates: async () => false,
    saveSettings: async settings => { state.settings = { ...state.settings, ...settings }; emit(); return clone(state); },
    beginHotkeyCapture: async () => true,
    cancelHotkeyCapture: async () => true,
    connect: async () => clone(state),
    toggleRecording: async () => { state.obs.recording = !state.obs.recording; emit(); return clone(state); },
    saveClip: async () => {
      state.lastClip = new Date().toISOString();
      state.recordings.unshift(recording(`browser-demo-${state.recordings.length + 1}.mkv`, 0, 104_857_600));
      emit();
      return clone(state);
    },
    openFolder: () => desktopOnly('Opening folders'),
    openLibraryFolder: () => desktopOnly('Opening folders'),
    openRecording: () => desktopOnly('Playback'),
    getRecordingThumbnail: async () => null,
    setRecordingFavorite: setFavorite,
    deleteRecordings: async filePaths => {
      state.recordings = state.recordings.filter(item => !filePaths.includes(item.path));
      state.archivedRecordings = state.archivedRecordings.filter(item => !filePaths.includes(item.path));
      emit();
      return clone(state);
    },
    startMpv: () => desktopOnly('Video playback'),
    setMpvBounds: async () => true,
    mpvStatus: async () => ({ running: false, duration: 0, currentTime: 0, paused: true }),
    seekMpv: async () => true,
    toggleMpv: async () => true,
    pauseMpv: async () => true,
    setMpvVolume: async () => true,
    setMpvAudioMix: async () => true,
    closeMpv: async () => true,
    openMpvFullscreen: () => desktopOnly('Fullscreen playback'),
    listMicrophones: async () => [],
    microphoneLevel: async () => -60,
    setModalAppearance: async () => true,
    onTrimProgress: callback => callbacks.trim.push(callback),
    onMpvFrame: callback => callbacks.frame.push(callback),
    trimRecording: () => desktopOnly('Clip exporting'),
    getAudioTracks: async () => [],
    mixRecordingAudio: () => desktopOnly('Audio mixing'),
    onAudioMixProgress: callback => callbacks.mix.push(callback),
    chooseFolder: () => desktopOnly('Choosing folders'),
    openLogs: () => desktopOnly('Diagnostic logs'),
    listProcesses: async () => [
      { name: 'VALORANT-Win64-Shipping.exe' },
      { name: 'Minecraft.exe' },
      { name: 'Discord.exe' }
    ],
    onState: callback => callbacks.state.push(callback)
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="web.css">');
    document.body.insertAdjacentHTML('beforeend', '<aside class="web-demo-banner"><span><strong>Browser demo</strong> — explore the interface; recording and playback need the Windows app.</span><a href="/download">Get the app</a></aside>');
  });
})();
