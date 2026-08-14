const path = require('path');

const EXCLUDED_EXECUTABLES = new Set([
  'applicationframehost.exe', 'clips.exe', 'discord.exe', 'explorer.exe', 'helium.exe',
  'chrome.exe', 'firefox.exe', 'msedge.exe', 'opera.exe', 'brave.exe',
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'goggalaxy.exe',
  'battle.net.exe', 'upc.exe', 'eadesktop.exe', 'riotclientservices.exe',
  'vlc.exe', 'mpv.exe', 'obs64.exe', 'spotify.exe', 'devenv.exe', 'code.exe'
]);

function candidateKey(application) {
  return String(application?.name || '').trim().toLowerCase();
}

function isProbableGameWindow(application) {
  const key = candidateKey(application);
  if (!key || !key.endsWith('.exe') || EXCLUDED_EXECUTABLES.has(key)) return false;
  const bounds = application?.bounds;
  if (!bounds || bounds.width < 960 || bounds.height < 540) return false;
  const executablePath = String(application.path || '').toLowerCase();
  if (executablePath) {
    const windows = String(process.env.WINDIR || 'C:\\Windows').toLowerCase();
    if (executablePath.startsWith(`${windows}${path.sep}`)) return false;
    if (executablePath.includes(`${path.sep}windowsapps${path.sep}`) && key === 'applicationframehost.exe') return false;
  }
  return true;
}

function updateCandidateHistory(history, applications, configured = [], ignored = [], now = Date.now()) {
  const blocked = new Set([...configured, ...ignored].map(value => String(value).toLowerCase()));
  const visible = new Set();
  for (const application of applications) {
    const key = candidateKey(application);
    if (!key || blocked.has(key) || !isProbableGameWindow(application)) continue;
    visible.add(key);
    const previous = history.get(key);
    history.set(key, previous ? { ...previous, application, lastSeenAt: now } : {
      application, firstSeenAt: now, lastSeenAt: now
    });
  }
  for (const [key, entry] of history) {
    if (blocked.has(key)) {
      history.delete(key);
      continue;
    }
    if (!visible.has(key) && now - entry.lastSeenAt > 30000) history.delete(key);
  }
  return [...history.values()]
    .filter(entry => now - entry.firstSeenAt >= 15000)
    .sort((left, right) => left.firstSeenAt - right.firstSeenAt)
    .map(entry => entry.application);
}

module.exports = { candidateKey, isProbableGameWindow, updateCandidateHistory };
