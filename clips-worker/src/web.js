(() => {
  const callbacks = { state: [], trim: [], frame: [], mix: [] };
  const clone = value => structuredClone(value);

  const sessionKey = 'clips-gateway-session-v1';
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  let gatewayToken = fragment.get('gateway') || '';
  let gatewayPort = Number(fragment.get('port')) || 32191;
  let gatewayConnected = false;
  let gatewayAttempted = false;
  let gatewayReconnectTimer = null;
  let events = null;
  let currentState = null;
  let browserMediaDuration = 0;
  let browserMediaOffset = 0;
  let browserMediaPath = '';
  let browserSeekTimer = null;

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
    document.title = 'Clips';
    document.body?.classList.toggle('gateway-connected', connected);
  }
  function connectEvents() {
    events?.close();
    const uiVersion = encodeURIComponent(currentState?.app?.version || '');
    events = new EventSource(`${gatewayBase()}/events?token=${encodeURIComponent(gatewayToken)}&uiVersion=${uiVersion}`);
    events.addEventListener('state', event => {
      currentState = JSON.parse(event.data);
      callbacks.state.forEach(callback => callback(clone(currentState)));
    });
    events.addEventListener('trim-progress', event => callbacks.trim.forEach(callback => callback(JSON.parse(event.data))));
    events.addEventListener('audio-mix-progress', event => callbacks.mix.forEach(callback => callback(JSON.parse(event.data))));
    events.addEventListener('activate-ui', () => {
      window.focus();
      document.documentElement.scrollIntoView({ block: 'start' });
    });
    events.addEventListener('open', () => setConnected(true));
    events.addEventListener('error', () => {
      events?.close();
      events = null;
      setConnected(false);
      clearTimeout(gatewayReconnectTimer);
      gatewayReconnectTimer = setTimeout(reconnectGateway, 500);
    });
  }
  async function reconnectGateway() {
    try {
      await activateGateway();
      callbacks.state.forEach(callback => callback(clone(currentState)));
    } catch {
      try { await pairGateway(); } catch {}
    }
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
    try {
      const health = await responseJson(await localFetch(`${gatewayBase()}/health`));
      if (health.product !== 'jss/clips' || health.apiVersion !== 1) throw new Error('The installed Clips gateway is not compatible.');
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
      clearTimeout(gatewayReconnectTimer);
      gatewayReconnectTimer = setTimeout(reconnectGateway, 1000);
      throw error;
    }
  }
  const desktopOnly = async feature => { throw new Error(`${feature} needs a connection to the installed Windows app.`); };
  async function getState() {
    await tryGateway();
    if (!gatewayConnected) await pairGateway();
    if (!currentState) throw new Error('Clips is not connected.');
    return clone(currentState);
  }
  const use = method => (...args) => gatewayConnected ? rpc(method, args) : desktopOnly('This action');
  async function startBrowserPlayback(filePath) {
    if (!gatewayConnected) return desktopOnly('Video playback');
    const loading = document.getElementById('mpv-loading');
    loading?.classList.remove('hidden');
    browserMediaPath = filePath;
    browserMediaOffset = 0;
    const media = await rpc('getRecordingMedia', [filePath, 0]);
    const mediaUrl = typeof media === 'string' ? media : media.url;
    browserMediaDuration = Number(media.duration) || 0;
    const video = document.getElementById('browser-video');
    video.crossOrigin = 'anonymous';
    video.src = mediaUrl;
    video.load();
    await new Promise((resolve, reject) => {
      if (video.readyState >= 3) { resolve(); return; }
      video.addEventListener('canplay', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('The browser could not play this recording.')), { once: true });
    });
    return { duration: browserMediaDuration || video.duration || 0, mediaUrl };
  }
  async function seekBrowserPlayback(seconds) {
    const video = browserVideo();
    if (!video || !browserMediaPath) return false;
    browserMediaOffset = Math.max(0, Math.min(browserMediaDuration, Number(seconds) || 0));
    document.getElementById('mpv-loading')?.classList.remove('hidden');
    clearTimeout(browserSeekTimer);
    browserSeekTimer = setTimeout(async () => {
      const wasPaused = video.paused;
      try {
        const media = await rpc('getRecordingMedia', [browserMediaPath, browserMediaOffset]);
        video.src = typeof media === 'string' ? media : media.url;
        video.load();
        if (!wasPaused) await video.play();
      } catch {}
    }, 120);
    return true;
  }
  const browserVideo = () => document.getElementById('browser-video');

  window.clips = {
    getState,
    installUpdate: use('installUpdate'),
    checkForUpdates: use('checkForUpdates'),
    copyUpdateDiagnostics: use('copyUpdateDiagnostics'),
    saveSettings: use('saveSettings'),
    beginHotkeyCapture: use('beginHotkeyCapture'),
    cancelHotkeyCapture: use('cancelHotkeyCapture'),
    connect: use('connect'),
    toggleRecording: use('toggleRecording'),
    saveClip: use('saveClip'),
    openFolder: use('openFolder'),
    openLibraryFolder: use('openLibraryFolder'),
    openRecording: use('openRecording'),
    getRecordingThumbnail: use('getRecordingThumbnail'),
    setRecordingFavorite: use('setRecordingFavorite'),
    updateRecordingMetadata: use('updateRecordingMetadata'),
    stitchRecordings: use('stitchRecordings'),
    deleteRecordings: use('deleteRecordings'),
    startMpv: startBrowserPlayback,
    setMpvBounds: async () => true,
    mpvStatus: async () => ({ running: !!browserVideo()?.src, duration: browserMediaDuration || browserVideo()?.duration || 0, currentTime: browserMediaOffset + (browserVideo()?.currentTime || 0), paused: browserVideo()?.paused ?? true }),
    seekMpv: seekBrowserPlayback,
    toggleMpv: async () => { const video = browserVideo(); if (!video) return false; if (video.paused) await video.play(); else video.pause(); return true; },
    pauseMpv: async paused => { const video = browserVideo(); if (!video) return false; if (paused) video.pause(); else await video.play(); return true; },
    setMpvVolume: async volume => { if (browserVideo()) browserVideo().volume = Math.max(0, Math.min(1, Number(volume) / 100)); return true; },
    setMpvAudioMix: async () => true,
    closeMpv: async () => { clearTimeout(browserSeekTimer); browserMediaPath = ''; browserMediaOffset = 0; browserMediaDuration = 0; const video = browserVideo(); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } return true; },
    openMpvFullscreen: async () => {
      const video = browserVideo();
      if (!video) return { inPage: true };
      video.controls = true;
      await video.requestFullscreen();
      return { inPage: true };
    },
    listMicrophones: use('listMicrophones'),
    microphoneLevel: use('microphoneLevel'),
    setModalAppearance: async () => true,
    onTrimProgress: callback => callbacks.trim.push(callback),
    onMpvFrame: callback => callbacks.frame.push(callback),
    trimRecording: use('trimRecording'),
    getAudioTracks: use('getAudioTracks'),
    mixRecordingAudio: use('mixRecordingAudio'),
    onAudioMixProgress: callback => callbacks.mix.push(callback),
    chooseFolder: use('chooseFolder'),
    openLogs: use('openLogs'),
    listProcesses: use('listProcesses'),
    onState: callback => callbacks.state.push(callback)
  };

  window.addEventListener('DOMContentLoaded', () => {
    const video = browserVideo();
    const showLoading = () => document.getElementById('mpv-loading')?.classList.remove('hidden');
    const hideLoading = () => document.getElementById('mpv-loading')?.classList.add('hidden');
    video?.addEventListener('loadstart', showLoading);
    video?.addEventListener('waiting', showLoading);
    video?.addEventListener('seeking', showLoading);
    video?.addEventListener('canplay', hideLoading);
    video?.addEventListener('playing', hideLoading);
    document.addEventListener('fullscreenchange', () => {
      if (video) video.controls = document.fullscreenElement === video;
    });
  });
})();
