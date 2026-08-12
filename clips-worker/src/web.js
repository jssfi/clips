(() => {
  const now = Date.now();
  const callbacks = { state: [], trim: [], frame: [], mix: [] };
  const clone = value => structuredClone(value);
  const recording = (name, minutesAgo, bytes, kind = 'replay', favorite = false, day) => ({
    path: `demo://${name}`,
    name,
    modified: new Date(now - minutesAgo * 60_000).toISOString(),
    bytes,
    kind,
    favorite,
    ...(day ? { day } : {})
  });
  const demoState = {
    settings: {
      recordingsFolder: 'C:\\Users\\You\\Videos\\Clips',
      retentionDays: 14,
      storageCleanupMode: 'disk',
      maxDiskUsagePercent: 80,
      maxRawRecordingGigabytes: 250,
      gameExecutables: ['VALORANT-Win64-Shipping.exe', 'Minecraft.exe'],
      audioExecutables: ['Discord.exe'],
      gameProfiles: {},
      autoRecord: true,
      startWithWindows: true,
      desktopWindow: true,
      clipHotkey: 'CommandOrControl+Shift+F10',
      markerHotkey: 'CommandOrControl+Shift+F9',
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
    storage: { totalBytes: 4_974_776_259, driveFreeBytes: 214_748_364_800, byGame: [] },
    lastError: '',
    lastClip: null,
    captureEngineInstalled: true,
    app: { version: 'web demo', buildTime: new Date().toISOString(), runtimeVersion: 'desktop only', runtimeReady: true, changelog: [] },
    telemetry: { configured: false, mode: 'off' },
    update: { status: 'idle', configured: false }
  };

  const sessionKey = 'clips-gateway-session-v1';
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  let gatewayToken = fragment.get('gateway') || '';
  let gatewayPort = Number(fragment.get('port')) || 32191;
  let gatewayConnected = false;
  let gatewayAttempted = false;
  let events = null;
  let banner = null;
  let currentState = demoState;

  try {
    if (!gatewayToken) {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      gatewayToken = String(saved?.token || '');
      gatewayPort = Number(saved?.port) || gatewayPort;
    }
    if (fragment.has('gateway')) {
      sessionStorage.setItem(sessionKey, JSON.stringify({ token: gatewayToken, port: gatewayPort }));
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
  } catch {}

  const gatewayBase = () => `http://127.0.0.1:${gatewayPort}/v1`;
  const localFetch = (url, options = {}) => fetch(url, { ...options, targetAddressSpace: 'local' });
  async function responseJson(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Clips returned ${response.status}.`);
    return body;
  }
  async function rpc(method, args = []) {
    if (!gatewayToken) throw new Error('This browser is not connected to Clips.');
    const response = await localFetch(`${gatewayBase()}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, args })
    });
    const body = await responseJson(response);
    return body.result;
  }
  function setConnected(connected) {
    gatewayConnected = connected;
    document.title = connected ? 'Clips' : 'Clips — browser demo';
    document.body?.classList.toggle('gateway-connected', connected);
    updateBanner();
  }
  function connectEvents() {
    events?.close();
    events = new EventSource(`${gatewayBase()}/events?token=${encodeURIComponent(gatewayToken)}`);
    events.addEventListener('state', event => {
      currentState = JSON.parse(event.data);
      callbacks.state.forEach(callback => callback(clone(currentState)));
    });
    events.addEventListener('trim-progress', event => callbacks.trim.forEach(callback => callback(JSON.parse(event.data))));
    events.addEventListener('audio-mix-progress', event => callbacks.mix.forEach(callback => callback(JSON.parse(event.data))));
    events.addEventListener('open', () => setConnected(true));
    events.addEventListener('error', () => {
      events?.close();
      events = null;
      setConnected(false);
      updateBanner('the connection ended; reconnect after Clips is running again.');
    });
  }
  async function activateGateway() {
    const state = await rpc('getState');
    currentState = state;
    setConnected(true);
    connectEvents();
    return clone(state);
  }
  async function tryGateway() {
    if (gatewayAttempted || !gatewayToken) return false;
    gatewayAttempted = true;
    try {
      await activateGateway();
      return true;
    } catch {
      gatewayToken = '';
      try { sessionStorage.removeItem(sessionKey); } catch {}
      setConnected(false);
      return false;
    }
  }
  async function pairGateway() {
    if (location.protocol === 'https:') {
      location.assign(`http://127.0.0.1:${gatewayPort}/app/`);
      return;
    }
    updateBanner('Looking for Clips…');
    try {
      const health = await responseJson(await localFetch(`${gatewayBase()}/health`));
      if (health.product !== 'jss/clips' || health.apiVersion !== 1) throw new Error('The installed Clips gateway is not compatible.');
      updateBanner('Approve the connection in Clips…');
      const paired = await responseJson(await localFetch(`${gatewayBase()}/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: navigator.userAgentData?.platform || navigator.platform || 'Browser' })
      }));
      gatewayToken = paired.token;
      try { sessionStorage.setItem(sessionKey, JSON.stringify({ token: gatewayToken, port: gatewayPort })); } catch {}
      await activateGateway();
      callbacks.state.forEach(callback => callback(clone(currentState)));
    } catch (error) {
      setConnected(false);
      updateBanner(error.message || 'Clips is not running.');
    }
  }

  function updateBanner(message = '') {
    if (!banner) return;
    if (gatewayConnected) {
      banner.innerHTML = '<span><strong>Connected</strong> — this page is controlling Clips on this computer.</span><button type="button" data-gateway-refresh>Refresh</button>';
      banner.querySelector('[data-gateway-refresh]').onclick = () => rpc('getState').then(state => {
        currentState = state;
        callbacks.state.forEach(callback => callback(clone(state)));
      });
      return;
    }
    banner.innerHTML = `<span><strong>Browser demo</strong> — ${message || 'connect the installed app to use the real recorder.'}</span><button type="button" data-gateway-connect>Connect Clips</button><a href="/download/setup">Get the app</a>`;
    banner.querySelector('[data-gateway-connect]').onclick = pairGateway;
  }

  const demoEmit = () => callbacks.state.forEach(callback => callback(clone(demoState)));
  const desktopOnly = async feature => { throw new Error(`${feature} needs a connection to the installed Windows app.`); };
  async function getState() {
    if (!demoState.app.changelog.length) {
      try { demoState.app.changelog = await fetch('changelog.json').then(response => response.json()); } catch {}
    }
    await tryGateway();
    return clone(gatewayConnected ? currentState : demoState);
  }
  const use = (method, fallback) => (...args) => gatewayConnected ? rpc(method, args) : fallback(...args);
  const setDemoFavorite = async (filePath, favorite) => {
    [...demoState.recordings, ...demoState.archivedRecordings].forEach(item => { if (item.path === filePath) item.favorite = favorite; });
    demoEmit();
    return clone(demoState);
  };
  async function startBrowserPlayback(filePath) {
    if (!gatewayConnected) return desktopOnly('Video playback');
    const mediaUrl = await rpc('getRecordingMedia', [filePath]);
    const video = document.getElementById('browser-video');
    video.crossOrigin = 'anonymous';
    video.src = mediaUrl;
    video.load();
    await new Promise((resolve, reject) => {
      if (video.readyState >= 1) { resolve(); return; }
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('The browser could not play this recording.')), { once: true });
    });
    return { duration: video.duration || 0, mediaUrl };
  }
  const browserVideo = () => document.getElementById('browser-video');

  window.clips = {
    getState,
    installUpdate: use('installUpdate', () => desktopOnly('Installing updates')),
    checkForUpdates: use('checkForUpdates', async () => false),
    saveSettings: use('saveSettings', async settings => { demoState.settings = { ...demoState.settings, ...settings }; demoEmit(); return clone(demoState); }),
    beginHotkeyCapture: use('beginHotkeyCapture', async () => true),
    cancelHotkeyCapture: use('cancelHotkeyCapture', async () => true),
    connect: use('connect', async () => clone(demoState)),
    toggleRecording: use('toggleRecording', async () => { demoState.obs.recording = !demoState.obs.recording; demoEmit(); return clone(demoState); }),
    saveClip: use('saveClip', async () => { demoState.lastClip = new Date().toISOString(); demoState.recordings.unshift(recording(`browser-demo-${demoState.recordings.length + 1}.mkv`, 0, 104_857_600)); demoEmit(); return clone(demoState); }),
    openFolder: use('openFolder', () => desktopOnly('Opening folders')),
    openLibraryFolder: use('openLibraryFolder', () => desktopOnly('Opening folders')),
    openRecording: use('openRecording', () => desktopOnly('Playback')),
    getRecordingThumbnail: use('getRecordingThumbnail', async () => null),
    setRecordingFavorite: use('setRecordingFavorite', setDemoFavorite),
    updateRecordingMetadata: use('updateRecordingMetadata', async (filePath, change) => { const item = [...demoState.recordings, ...demoState.archivedRecordings].find(entry => entry.path === filePath); if (item) Object.assign(item, change); demoEmit(); return clone(demoState); }),
    stitchRecordings: use('stitchRecordings', () => desktopOnly('Stitching clips')),
    deleteRecordings: use('deleteRecordings', async filePaths => { demoState.recordings = demoState.recordings.filter(item => !filePaths.includes(item.path)); demoState.archivedRecordings = demoState.archivedRecordings.filter(item => !filePaths.includes(item.path)); demoEmit(); return clone(demoState); }),
    startMpv: startBrowserPlayback,
    setMpvBounds: async () => true,
    mpvStatus: async () => ({ running: !!browserVideo()?.src, duration: browserVideo()?.duration || 0, currentTime: browserVideo()?.currentTime || 0, paused: browserVideo()?.paused ?? true }),
    seekMpv: async seconds => { if (browserVideo()) browserVideo().currentTime = Number(seconds) || 0; return true; },
    toggleMpv: async () => { const video = browserVideo(); if (!video) return false; if (video.paused) await video.play(); else video.pause(); return true; },
    pauseMpv: async paused => { const video = browserVideo(); if (!video) return false; if (paused) video.pause(); else await video.play(); return true; },
    setMpvVolume: async volume => { if (browserVideo()) browserVideo().volume = Math.max(0, Math.min(1, Number(volume) / 100)); return true; },
    setMpvAudioMix: async () => true,
    closeMpv: async () => { const video = browserVideo(); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } return true; },
    openMpvFullscreen: async () => { await browserVideo()?.requestFullscreen(); return true; },
    listMicrophones: use('listMicrophones', async () => []),
    microphoneLevel: use('microphoneLevel', async () => -60),
    setModalAppearance: async () => true,
    onTrimProgress: callback => callbacks.trim.push(callback),
    onMpvFrame: callback => callbacks.frame.push(callback),
    trimRecording: use('trimRecording', () => desktopOnly('Clip exporting')),
    getAudioTracks: use('getAudioTracks', async () => []),
    mixRecordingAudio: use('mixRecordingAudio', () => desktopOnly('Audio mixing')),
    onAudioMixProgress: callback => callbacks.mix.push(callback),
    chooseFolder: use('chooseFolder', () => desktopOnly('Choosing folders')),
    openLogs: use('openLogs', () => desktopOnly('Diagnostic logs')),
    listProcesses: use('listProcesses', async () => [
      { name: 'VALORANT-Win64-Shipping.exe', title: 'VALORANT' },
      { name: 'Minecraft.exe', title: 'Minecraft' },
      { name: 'Discord.exe', title: 'Discord' }
    ]),
    onState: callback => callbacks.state.push(callback)
  };

  window.addEventListener('DOMContentLoaded', () => {
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="web.css">');
    document.body.insertAdjacentHTML('beforeend', '<aside class="web-demo-banner" aria-live="polite"></aside>');
    banner = document.querySelector('.web-demo-banner');
    updateBanner();
  });
})();
