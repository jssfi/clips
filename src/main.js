const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, execFileSync, spawn } = require('child_process');
const { promisify } = require('util');
const { ObsController } = require('./obs');

// Keep the original data directory so the product rename does not reset user settings.
app.setPath('userData', path.join(app.getPath('appData'), 'Clippy'));
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const execFileAsync = promisify(execFile);
const SYSTEM_OBS_PATH = 'C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe';
const DEFAULTS = {
  obsPort: 4455, obsPassword: '', recordingsFolder: path.join(os.homedir(), 'Videos', 'Clippy'),
  retentionDays: 1, gameExecutables: [], audioExecutables: ['Discord.exe'],
  autoRecord: true, startWithWindows: true, clipHotkey: 'CommandOrControl+Shift+F10',
  pollSeconds: 5, stopDelaySeconds: 20, clipLengthSeconds: 60
};

let win, tray, settings, monitorTimer, startupConnectTimer, stopTimer, connectPromise, lastError = '', activeGames = [], runningApps = [], lastClip = '', sessionDate = '';
const obs = new ObsController(() => broadcast());
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function obsPath() {
  const bundled = path.join(process.resourcesPath, 'obs-studio', 'bin', '64bit', 'obs64.exe');
  return app.isPackaged && fs.existsSync(bundled) ? bundled : SYSTEM_OBS_PATH;
}
function enableObsWebSocket() {
  const configPath = path.join(app.getPath('appData'), 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  config.server_enabled = true;
  config.server_port = Number(settings.obsPort) || 4455;
  if (!settings.obsPassword) config.auth_required = false;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
function enableReplayBufferProfiles() {
  const profilesRoot = path.join(app.getPath('appData'), 'obs-studio', 'basic', 'profiles');
  if (!fs.existsSync(profilesRoot)) return;
  for (const profile of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    const configPath = path.join(profilesRoot, profile.name, 'basic.ini');
    if (!fs.existsSync(configPath)) continue;
    let config = fs.readFileSync(configPath, 'utf8');
    const updated = config
      .replace(/^RecRB[ \t]*=.*$/gim, 'RecRB=true')
      .replace(/^RecRBTime[ \t]*=.*$/gim, `RecRBTime=${Math.max(5, Number(settings.clipLengthSeconds) || 60)}`);
    if (updated !== config) fs.writeFileSync(configPath, updated);
  }
}
function launchObsBackground() {
  const executable = obsPath();
  if (!fs.existsSync(executable)) return false;
  enableObsWebSocket();
  enableReplayBufferProfiles();
  try {
    const running = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], { windowsHide: true, encoding: 'utf8' });
    if (/obs64\.exe/i.test(running)) return true;
  } catch {}
  spawn(executable, ['--minimize-to-tray', '--disable-shutdown-check'], { detached: true, cwd: path.dirname(executable), windowsHide: true }).unref();
  return true;
}
async function showObsWindow() {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ClippyWindow {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$ids = @(Get-Process obs64 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$windows = New-Object System.Collections.ArrayList
[ClippyWindow]::EnumWindows({
  param($handle, $unused)
  $pidForWindow = 0
  [ClippyWindow]::GetWindowThreadProcessId($handle, [ref]$pidForWindow) | Out-Null
  if ($ids -contains $pidForWindow) {
    $title = New-Object System.Text.StringBuilder 512
    [ClippyWindow]::GetWindowText($handle, $title, 512) | Out-Null
    if ($title.ToString() -match '^OBS [0-9]') { $null = $windows.Add($handle) }
  }
  return $true
}, [IntPtr]::Zero) | Out-Null
if ($windows.Count -gt 0) {
  [ClippyWindow]::ShowWindowAsync($windows[0], 9) | Out-Null
  [ClippyWindow]::SetForegroundWindow($windows[0]) | Out-Null
  exit 0
}
exit 1`;
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    return true;
  } catch { return false; }
}

function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (saved.clipLengthSeconds == null) saved.clipLengthSeconds = Number(saved.stopDelaySeconds) || 60;
    return { ...DEFAULTS, ...saved };
  }
  catch { return { ...DEFAULTS }; }
}
function persist() { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); }
function todayFolder() {
  const date = new Date().toLocaleDateString('sv-SE');
  const folder = path.join(settings.recordingsFolder, date);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}
function todayKey() { return new Date().toLocaleDateString('sv-SE'); }
async function startSession() {
  cleanupOldDays();
  const wantedAudio = new Set([...settings.audioExecutables, ...activeGames].map(name => name.toLowerCase()));
  await obs.configureApplicationAudio(runningApps.filter(app => wantedAudio.has(app.name.toLowerCase())));
  await obs.startSession(todayFolder());
  sessionDate = todayKey();
}
function cleanupOldDays() {
  fs.mkdirSync(settings.recordingsFolder, { recursive: true });
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - (settings.retentionDays - 1));
  for (const item of fs.readdirSync(settings.recordingsFolder, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(item.name)) continue;
    const date = new Date(`${item.name}T00:00:00`);
    if (date < cutoff) fs.rmSync(path.join(settings.recordingsFolder, item.name), { recursive: true, force: true });
  }
}
function recentRecordings() {
  const root = path.join(settings.recordingsFolder, todayKey());
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isFile() && /\.(mkv|mp4|mov|webm|flv)$/i.test(item.name))
    .map(item => { const fullPath = path.join(root, item.name); const stat = fs.statSync(fullPath); return { name: item.name, path: fullPath, bytes: stat.size, modified: stat.mtime.toISOString(), kind: /^Replay(?:[ _-]|$)/i.test(item.name) ? 'replay' : 'recording' }; })
    .sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 24);
}
async function processes() {
  const script = `Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ClippyProcessWindow {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
}
'@
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
    $processPath = $null
    try { $processPath = $_.Path } catch {}
    $windowClass = New-Object System.Text.StringBuilder 256
    [ClippyProcessWindow]::GetClassName($_.MainWindowHandle, $windowClass, 256) | Out-Null
    [pscustomobject]@{
      name = $_.ProcessName + '.exe'
      path = $processPath
      title = $_.MainWindowTitle
      windowClass = $windowClass.ToString()
    }
  } | Sort-Object name -Unique | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  const parsed = JSON.parse(stdout || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
    name: item.name,
    path: item.path || '',
    title: item.title || item.name,
    windowClass: item.windowClass || ''
  }));
}
async function monitor() {
  try {
    if (!obs.connected) {
      launchObsBackground();
      await tryConnect();
    }
    const running = await processes();
    runningApps = running;
    const wanted = new Set(settings.gameExecutables.map(x => x.toLowerCase()));
    activeGames = running.filter(p => wanted.has(p.name.toLowerCase())).map(p => p.name);
    if (settings.autoRecord && activeGames.length) {
      clearTimeout(stopTimer); stopTimer = null;
      if (obs.connected) {
        const status = await obs.status();
        if (status.recording && sessionDate && sessionDate !== todayKey()) {
          await obs.stopSession();
          await startSession();
        } else if (!status.recording) await startSession();
      }
    } else if (settings.autoRecord && !activeGames.length && !stopTimer && (await obs.status()).recording) {
      stopTimer = setTimeout(async () => { stopTimer = null; if (!activeGames.length) await obs.stopSession().catch(setError); }, settings.stopDelaySeconds * 1000);
    }
    lastError = '';
  } catch (error) { setError(error); }
  broadcast();
}
function setError(error) { lastError = error?.message || String(error); broadcast(); }
async function tryConnect() {
  if (obs.connected) return true;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      await obs.connect(settings.obsPort, settings.obsPassword);
      await obs.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'RecRB', parameterValue: 'true' }).catch(() => {});
      await obs.call('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'RecRB', parameterValue: 'true' }).catch(() => {});
      await obs.call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'RecRBTime', parameterValue: String(settings.clipLengthSeconds) }).catch(() => {});
      await obs.call('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'RecRBTime', parameterValue: String(settings.clipLengthSeconds) }).catch(() => {});
      lastError = '';
      return true;
    } catch (error) {
      setError(error);
      return false;
    } finally {
      connectPromise = null;
    }
  })();
  return connectPromise;
}
async function state() { return { settings, obs: await obs.status(), activeGames, recordings: recentRecordings(), lastError, lastClip, obsInstalled: fs.existsSync(obsPath()), bundledObs: app.isPackaged && obsPath() !== SYSTEM_OBS_PATH }; }
async function broadcast() { if (win && !win.isDestroyed()) win.webContents.send('state', await state()); }
function scheduleMonitor() { clearInterval(monitorTimer); monitorTimer = setInterval(monitor, Math.max(2, settings.pollSeconds) * 1000); monitor(); }
function startConnectionWarmup() {
  clearInterval(startupConnectTimer);
  let attempts = 0;
  startupConnectTimer = setInterval(async () => {
    attempts += 1;
    if (obs.connected || attempts >= 45) {
      clearInterval(startupConnectTimer);
      startupConnectTimer = null;
      return;
    }
    launchObsBackground();
    await tryConnect();
  }, 1000);
}
function registerHotkey() { globalShortcut.unregisterAll(); if (settings.clipHotkey) globalShortcut.register(settings.clipHotkey, () => saveClip()); }
async function saveClip() { try { await obs.saveClip(); lastClip = new Date().toISOString(); lastError = ''; } catch (e) { setError(e); } broadcast(); }

function createWindow() {
  const hidden = process.argv.includes('--hidden');
  win = new BrowserWindow({ show: !hidden, width: 1160, height: 780, minWidth: 900, minHeight: 650, backgroundColor: '#0b0c0e', title: 'jss/clips', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.setMenuBarVisibility(false); win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', e => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

app.whenReady().then(() => {
  settings = loadSettings();
  app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] });
  launchObsBackground(); createWindow(); registerHotkey(); scheduleMonitor(); startConnectionWarmup();
  tray = new Tray(nativeImage.createEmpty()); tray.setToolTip('jss/clips'); tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open jss/clips', click: () => win.show() }, { label: 'Save clip', click: saveClip }, { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('will-quit', () => globalShortcut.unregisterAll());

ipcMain.handle('state:get', state);
ipcMain.handle('obs:connect', async () => { await tryConnect(); return state(); });
ipcMain.handle('settings:save', async (_e, next) => {
  const previousClipLength = settings.clipLengthSeconds;
  settings = { ...settings, ...next, retentionDays: Math.max(1, Number(next.retentionDays) || 1), clipLengthSeconds: Math.max(5, Number(next.clipLengthSeconds) || 60) };
  clearTimeout(stopTimer);
  stopTimer = null;
  persist(); app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] }); registerHotkey(); scheduleMonitor();
  if (obs.connected && previousClipLength !== settings.clipLengthSeconds) await obs.setReplayBufferDuration(settings.clipLengthSeconds).catch(setError);
  return state();
});
ipcMain.handle('recording:toggle', async () => { try { const s = await obs.status(); if (s.recording) { await obs.stopSession(); sessionDate = ''; } else await startSession(); } catch (e) { setError(e); } return state(); });
ipcMain.handle('clip:save', async () => { await saveClip(); return state(); });
ipcMain.handle('obs:open', async () => {
  if (await showObsWindow()) return;
  const executable = obsPath();
  if (fs.existsSync(executable)) spawn(executable, ['--disable-shutdown-check'], { detached: true, cwd: path.dirname(executable) }).unref();
  else await shell.openExternal('https://obsproject.com/download');
});
ipcMain.handle('folder:open', () => shell.openPath(todayFolder()));
ipcMain.handle('recording:open', async (_event, filePath) => {
  const root = path.resolve(settings.recordingsFolder) + path.sep;
  const target = path.resolve(String(filePath || ''));
  if (!target.startsWith(root) || !fs.existsSync(target)) throw new Error('Recording no longer exists.');
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
});
ipcMain.handle('folder:choose', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('processes:list', processes);
