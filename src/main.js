const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { execFile, execFileSync, spawn } = require('child_process');
const { promisify } = require('util');
const { ObsController } = require('./obs');
const buildInfo = require('./build-info.json');
const { RUNTIME_VERSION, runtimeRoot, isRuntimeReady, ensureRuntimeInstalled } = require('./runtime');
const { redirectToActiveVersion, createStagedUpdater } = require('./updater');
const { trayIconPng } = require('./tray-icon');
const { MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT, mpvFullscreenArgs } = require('./mpv-fullscreen');
const { createLogger } = require('./logger');
const { normalizeSettingsUpdate, captureRestartRequired } = require('./settings');
const { configuredEndpoint, loadInstallationId, createTelemetry } = require('./telemetry');
const { parseProcessList } = require('./process-list');
const { displayVersion } = require('./version');
const changelog = require('./changelog.json');

const legacyUserDataPath = path.join(app.getPath('appData'), 'Clippy');
app.setPath('userData', path.join(app.getPath('appData'), 'Clips'));
const redirectedToActiveVersion = redirectToActiveVersion(app);
const gotSingleInstanceLock = !redirectedToActiveVersion && app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

const execFileAsync = promisify(execFile);
let releaseConfig = {};
try { releaseConfig = require('./release-config.json'); } catch {}
const DEFAULT_UPDATE_URL = String(releaseConfig.updateUrl || '');
const DEFAULT_NVAFX_SDK_DIR = 'C:\\Program Files\\NVIDIA Corporation\\NVIDIA Audio Effects SDK';
if (!process.env.NVAFX_SDK_DIR && fs.existsSync(path.join(DEFAULT_NVAFX_SDK_DIR, 'NVAudioEffects.dll'))) {
  // Staged updates relaunch from the old process, which does not inherit newly
  // installed machine environment variables until the next Windows sign-in.
  process.env.NVAFX_SDK_DIR = DEFAULT_NVAFX_SDK_DIR;
}
const persistentRuntimeRoot = runtimeRoot(process.env.LOCALAPPDATA || app.getPath('userData'));
const DEFAULTS = {
  recordingsFolder: path.join(os.homedir(), 'Videos', 'Clips'),
  retentionDays: 1, storageCleanupMode: 'disk', maxDiskUsagePercent: 80, maxRawRecordingGigabytes: 250,
  gameExecutables: [], audioExecutables: ['Discord.exe'],
  autoRecord: true, startWithWindows: true, clipHotkey: 'CommandOrControl+Shift+F10',
  pollSeconds: 5, stopDelaySeconds: 20, clipLengthSeconds: 60,
  obsRecordingQuality: 'HQ', obsResolution: '1920x1080', obsFps: 60, obsFormat: 'mkv',
  microphoneDeviceId: 'disabled', microphoneVolumePercent: 100, microphoneNoiseGateDb: -40,
  microphoneNvidiaNoiseRemoval: true,
  trimBitrate: 'original',
  nightlyUpdates: false, telemetryMode: 'pending'
};

let win, toastWin, tray, settings, monitorTimer, stopTimer, toastHideTimer, toastRecoveryTimer, microphoneVolumePersistTimer, connectPromise, mediaServer, mediaPort = 0, autoRecordSuppressed = false, lastError = '', activeGames = [], runningApps = [], lastClip = '', sessionDate = '', toastReady = false, pendingToast = null;
let mpvProcess = null, mpvSocket = null, mpvBuffer = '', mpvRequestId = 0;
let mpvFrameBuffer = Buffer.alloc(0);
const mpvRequests = new Map();
const mediaTokens = new Map();
const thumbnailPromises = new Map();
let thumbnailQueue = Promise.resolve();
let updateState = { status: 'idle', version: app.getVersion(), percent: 0, message: '', configured: false };
let updateCheckTimer = null;
let updateCheckTimeout = null;
let updateConfigurationGeneration = 0;
let stagedUpdater = null;
let runtimeSetupPromise = Promise.resolve();
const logger = createLogger({ directory: path.join(app.getPath('userData'), 'logs') });
const telemetryEndpoint = configuredEndpoint();
let telemetry = null;
let systemInformation = null;
const obs = new ObsController(() => broadcast(), logger);
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const favoritesPath = () => path.join(app.getPath('userData'), 'favorites.json');
let favoriteRecordingKeys = new Set();
function recordingKey(filePath) {
  const relative = path.relative(path.resolve(settings.recordingsFolder), path.resolve(String(filePath || '')));
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  return relative.replace(/\\/g, '/').toLowerCase();
}
function loadFavorites() {
  try { favoriteRecordingKeys = new Set(JSON.parse(fs.readFileSync(favoritesPath(), 'utf8')).map(String)); }
  catch { favoriteRecordingKeys = new Set(); }
}
function persistFavorites() {
  const target = favoritesPath();
  const temporary = `${target}.working`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify([...favoriteRecordingKeys].sort(), null, 2)}\n`);
  fs.renameSync(temporary, target);
}
function isFavoriteRecording(filePath) { return favoriteRecordingKeys.has(recordingKey(filePath)); }
function captureRuntimeRoot() {
  return app.isPackaged ? persistentRuntimeRoot : path.join(__dirname, '..', 'vendor');
}
function captureHostPath() {
  return path.join(captureRuntimeRoot(), 'libobs', 'bin', '64bit', 'clips-capture-host.exe');
}
async function stopLegacyBundledObs() {
  if (!app.isPackaged) return;
  const legacyRoot = path.resolve(path.dirname(persistentRuntimeRoot), 'v1', 'obs-studio').toLowerCase();
  const script = "Get-CimInstance Win32_Process -Filter \"Name='obs64.exe'\" | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress";
  let processes = [];
  try {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      encoding: 'utf8'
    }).trim();
    if (output) {
      const parsed = JSON.parse(output);
      processes = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {}
  const legacy = processes.filter(processInfo => {
    const executable = path.resolve(String(processInfo.ExecutablePath || '')).toLowerCase();
    return executable === path.join(legacyRoot, 'bin', '64bit', 'obs64.exe');
  });
  for (const processInfo of legacy) {
    await execFileAsync('taskkill.exe', ['/PID', String(processInfo.ProcessId), '/T'], {
      windowsHide: true
    }).catch(() => {});
  }
}
function ffmpegPath() {
  const persistent = path.join(persistentRuntimeRoot, 'ffmpeg', 'ffmpeg.exe');
  if (app.isPackaged && isRuntimeReady(persistentRuntimeRoot)) return persistent;
  const bundled = path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');
  if (app.isPackaged && fs.existsSync(bundled)) return bundled;
  const staged = path.join(__dirname, '..', 'vendor', 'ffmpeg', 'ffmpeg.exe');
  return fs.existsSync(staged) ? staged : '';
}
function mpvPath() {
  const candidates = [
    path.join(persistentRuntimeRoot, 'mpv', 'mpv.exe'),
    path.join(process.resourcesPath, 'mpv', 'mpv.exe'),
    path.join(__dirname, '..', 'vendor', 'mpv', 'mpv.exe')
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || '';
}
function mpvFullscreenScriptPath() {
  const directory = path.join(app.getPath('userData'), 'mpv');
  const scriptPath = path.join(directory, 'quit-on-fullscreen-exit.lua');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(scriptPath, MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT);
  return scriptPath;
}
function loadSettings() {
  try {
    const currentPath = settingsPath();
    const legacyPath = path.join(legacyUserDataPath, 'settings.json');
    const sourcePath = fs.existsSync(currentPath) ? currentPath : legacyPath;
    const saved = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (saved.clipLengthSeconds == null) saved.clipLengthSeconds = Number(saved.stopDelaySeconds) || 60;
    const {
      freezeCaptureWhenUnfocused: _removed,
      obsPort: _removedPort,
      obsPassword: _removedPassword,
      obsSettingsManaged: _removedManagedFlag,
      microphoneNoiseSuppression: _removedNoiseSuppression,
      cdnUrl: _removedCdnUrl,
      cdnPassword: _removedCdnPassword,
      cdnPasswordEncrypted: _removedCdnPasswordEncrypted,
      ...currentSettings
    } = saved;
    return { ...DEFAULTS, ...currentSettings };
  }
  catch { return { ...DEFAULTS }; }
}
function persist() {
  const target = settingsPath();
  const temporary = `${target}.working`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stored = { ...settings };
  fs.writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`);
  fs.renameSync(temporary, target);
}
function ensureDirectory(folder) {
  if (fs.existsSync(folder)) {
    if (!fs.statSync(folder).isDirectory()) throw new Error(`Storage path is not a folder: ${folder}`);
    return;
  }
  fs.mkdirSync(folder, { recursive: true });
}
function todayFolder() {
  const date = new Date().toLocaleDateString('sv-SE');
  const folder = path.join(settings.recordingsFolder, date);
  ensureDirectory(folder);
  return folder;
}
function todayKey() { return new Date().toLocaleDateString('sv-SE'); }
async function startSession() {
  if (!await tryConnect()) throw new Error(lastError || 'The Clips capture engine could not start.');
  cleanupStorage();
  const wantedAudio = new Set([...settings.audioExecutables, ...activeGames].map(name => name.toLowerCase()));
  const outputDirectory = todayFolder();
  const audioApplications = runningApps.filter(app => wantedAudio.has(app.name.toLowerCase()));
  logger.info('starting capture session', {
    outputDirectory,
    microphoneDeviceId: settings.microphoneDeviceId,
    activeGames,
    audioApplications: audioApplications.map(application => application.name)
  });
  await obs.configureApplicationAudio(audioApplications);
  await obs.startSession(
    outputDirectory,
    activeGames,
    settings.microphoneDeviceId,
    settings.microphoneVolumePercent,
    settings.microphoneNoiseGateDb,
    settings.microphoneNvidiaNoiseRemoval
  );
  sessionDate = todayKey();
  showOverlayToast('Recording started', 'recording');
}
function isRawRecordingName(name) {
  return /\.(mkv|mp4|mov|webm|flv)$/i.test(name)
    && !/^Replay(?:[ _-]|$)/i.test(name)
    && !/-trimmed(?:-\d+)?(?=\.[^.]+$)/i.test(name);
}
function recordingFilesByAge({ beforeToday = false } = {}) {
  if (!fs.existsSync(settings.recordingsFolder)) return [];
  const today = todayKey();
  const files = [];
  for (const item of fs.readdirSync(settings.recordingsFolder, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(item.name)
      || (beforeToday && item.name >= today)) continue;
    const dayFolder = path.join(settings.recordingsFolder, item.name);
    for (const recording of fs.readdirSync(dayFolder, { withFileTypes: true })) {
      if (!recording.isFile() || !isRawRecordingName(recording.name)) continue;
      const filePath = path.join(dayFolder, recording.name);
      const stat = fs.statSync(filePath);
      files.push({ path: filePath, modified: stat.mtimeMs, bytes: stat.size, favorite: isFavoriteRecording(filePath) });
    }
  }
  return files.sort((a, b) => a.modified - b.modified);
}
function rawFootageBytes() {
  return recordingFilesByAge().reduce((total, recording) => total + recording.bytes, 0);
}
function diskUsagePercent() {
  const stats = fs.statfsSync(settings.recordingsFolder);
  if (!stats.blocks) return 0;
  return ((stats.blocks - stats.bavail) / stats.blocks) * 100;
}
function cleanupStorage() {
  ensureDirectory(settings.recordingsFolder);
  if (settings.storageCleanupMode === 'disk') {
    const limit = Math.min(99, Math.max(1, Number(settings.maxDiskUsagePercent) || 80));
    const rawLimit = Math.max(1, Number(settings.maxRawRecordingGigabytes) || 250) * 1024 ** 3;
    const isOverLimit = () => diskUsagePercent() >= limit || rawFootageBytes() > rawLimit;
    if (!isOverLimit()) return;
    // Never remove today's possibly-active recording, saved Replay clips, or trimmed exports.
    for (const recording of recordingFilesByAge({ beforeToday: true })) {
      if (recording.favorite) continue;
      fs.rmSync(recording.path, { force: true });
      if (!isOverLimit()) break;
    }
    return;
  }
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - (settings.retentionDays - 1));
  for (const item of fs.readdirSync(settings.recordingsFolder, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(item.name)) continue;
    const date = new Date(`${item.name}T00:00:00`);
    if (date >= cutoff) continue;
    const dayFolder = path.join(settings.recordingsFolder, item.name);
    for (const recording of fs.readdirSync(dayFolder, { withFileTypes: true })) {
      if (!recording.isFile() || !isRawRecordingName(recording.name)) continue;
      const filePath = path.join(dayFolder, recording.name);
      if (!isFavoriteRecording(filePath)) fs.rmSync(filePath, { force: true });
    }
  }
}
function recentRecordings() {
  const root = path.join(settings.recordingsFolder, todayKey());
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(item => item.isFile() && /\.(mkv|mp4|mov|webm|flv)$/i.test(item.name))
    .map(item => { const fullPath = path.join(root, item.name); const stat = fs.statSync(fullPath); return { name: item.name, path: fullPath, bytes: stat.size, modified: stat.mtime.toISOString(), kind: /^Replay(?:[ _-]|$)/i.test(item.name) ? 'replay' : 'recording', favorite: isFavoriteRecording(fullPath) }; })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.modified.localeCompare(a.modified)).slice(0, 24);
}
function archivedRecordings() {
  const root = settings.recordingsFolder;
  if (!fs.existsSync(root)) return [];
  const today = todayKey();
  const recordings = [];
  for (const day of fs.readdirSync(root, { withFileTypes: true })) {
    if (!day.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(day.name) || day.name === today) continue;
    const dayFolder = path.join(root, day.name);
    for (const item of fs.readdirSync(dayFolder, { withFileTypes: true })) {
      if (!item.isFile() || !/\.(mkv|mp4|mov|webm|flv)$/i.test(item.name)) continue;
      const fullPath = path.join(dayFolder, item.name);
      const stat = fs.statSync(fullPath);
      recordings.push({
        name: item.name, path: fullPath, bytes: stat.size, modified: stat.mtime.toISOString(),
        day: day.name, kind: /^Replay(?:[ _-]|$)/i.test(item.name) ? 'replay' : 'recording', favorite: isFavoriteRecording(fullPath)
      });
    }
  }
  return recordings.sort((a, b) => b.day.localeCompare(a.day) || b.modified.localeCompare(a.modified));
}
function validateRecordingPath(filePath) {
  const root = path.resolve(settings.recordingsFolder);
  const target = path.resolve(String(filePath || ''));
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error('Recording no longer exists.');
  }
  return target;
}
function mediaContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.flv': 'video/x-flv' })[extension] || 'application/octet-stream';
}
function startMediaServer() {
  if (mediaServer) return Promise.resolve();
  mediaServer = http.createServer((request, response) => {
    try {
      const token = new URL(request.url, 'http://127.0.0.1').pathname.split('/').pop();
      const entry = mediaTokens.get(token);
      if (!entry) { response.writeHead(404); response.end(); return; }
      const target = entry.sourcePath ? entry.filePath : validateRecordingPath(entry.filePath);
      const size = fs.statSync(target).size;
      const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      let start = 0;
      let end = size - 1;
      if (range) {
        if (range[1]) start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), end);
        if (!range[1] && range[2]) start = Math.max(0, size - Number(range[2]));
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
          response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return;
        }
      }
      const headers = {
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Type': mediaContentType(target),
        'Content-Length': String(end - start + 1)
      };
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      response.writeHead(range ? 206 : 200, headers);
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = fs.createReadStream(target, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404); response.end();
    }
  });
  return new Promise((resolve, reject) => {
    mediaServer.once('error', reject);
    mediaServer.listen(0, '127.0.0.1', () => {
      mediaServer.removeListener('error', reject);
      mediaPort = mediaServer.address().port;
      resolve();
    });
  });
}
async function previewPath(filePath) {
  const sourcePath = validateRecordingPath(filePath);
  if (path.extname(sourcePath).toLowerCase() === '.mp4') return sourcePath;
  const stat = fs.statSync(sourcePath);
  const cacheFolder = path.join(app.getPath('userData'), 'preview-cache');
  fs.mkdirSync(cacheFolder, { recursive: true });
  const key = crypto.createHash('sha256').update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 24);
  const outputPath = path.join(cacheFolder, `${key}.mp4`);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return outputPath;
  const temporaryPath = `${outputPath}.working.mp4`;
  const executable = ffmpegPath();
  if (!fs.existsSync(executable)) throw new Error('FFmpeg is missing from this Clips build.');
  try {
    try {
      await execFileAsync(executable, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
        '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', temporaryPath
      ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    } catch {
      fs.rmSync(temporaryPath, { force: true });
      await execFileAsync(executable, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
        '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', temporaryPath
      ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    }
    fs.renameSync(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(error.stderr?.trim() || 'Could not create a playable preview.');
  }
}
async function recordingThumbnail(filePath) {
  const sourcePath = validateRecordingPath(filePath);
  const stat = fs.statSync(sourcePath);
  const cacheFolder = path.join(app.getPath('userData'), 'thumbnail-cache-v2');
  fs.mkdirSync(cacheFolder, { recursive: true });
  const key = crypto.createHash('sha256').update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 24);
  const outputPath = path.join(cacheFolder, `${key}.jpg`);
  const readThumbnail = () => `data:image/jpeg;base64,${fs.readFileSync(outputPath).toString('base64')}`;
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return readThumbnail();
  if (thumbnailPromises.has(sourcePath)) return thumbnailPromises.get(sourcePath);
  const job = thumbnailQueue.then(async () => {
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return readThumbnail();
    const executable = ffmpegPath();
    if (!fs.existsSync(executable)) return '';
    const temporaryPath = `${outputPath}.working.jpg`;
    try {
      const renderThumbnail = filters => execFileAsync(executable, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', sourcePath,
        '-frames:v', '1', '-vf', filters,
        '-q:v', '3', '-strict', 'unofficial', temporaryPath
      ], { windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
      const scale = 'scale=640:360:force_original_aspect_ratio=increase,crop=640:360';
      try {
        await renderThumbnail(`signalstats,metadata=select:key=lavfi.signalstats.YAVG:value=18:function=greater,${scale}`);
        if (!fs.existsSync(temporaryPath) || !fs.statSync(temporaryPath).size) throw new Error('No visible frame found.');
      } catch {
        fs.rmSync(temporaryPath, { force: true });
        await renderThumbnail(scale);
      }
      fs.renameSync(temporaryPath, outputPath);
      return readThumbnail();
    } catch {
      fs.rmSync(temporaryPath, { force: true });
      return '';
    }
  });
  thumbnailQueue = job.catch(() => '');
  thumbnailPromises.set(sourcePath, job);
  try {
    return await job;
  } finally {
    thumbnailPromises.delete(sourcePath);
  }
}
async function recordingMediaUrl(filePath) {
  const target = validateRecordingPath(filePath);
  const playablePath = await previewPath(target);
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [token, entry] of mediaTokens) if (entry.createdAt < cutoff) mediaTokens.delete(token);
  const token = crypto.randomUUID();
  mediaTokens.set(token, { filePath: playablePath, sourcePath: target, createdAt: Date.now() });
  return `http://127.0.0.1:${mediaPort}/media/${token}`;
}
function closeMpvSession() {
  const child = mpvProcess;
  if (child?.stdin?.writable) child.stdin.write(`quit\t0\n`);
  if (child && !child.killed) setTimeout(() => { if (!child.killed) child.kill(); }, 500);
  mpvProcess = null;
  for (const pending of mpvRequests.values()) pending.reject(new Error('MPV closed.'));
  mpvRequests.clear();
}
function handleMpvData(chunk) {
  mpvBuffer += chunk.toString();
  let newline;
  while ((newline = mpvBuffer.indexOf('\n')) >= 0) {
    const line = mpvBuffer.slice(0, newline).replace(/\r$/, '');
    mpvBuffer = mpvBuffer.slice(newline + 1);
    const fields = line.split('\t');
    const requestId = Number(fields[0]);
    if (!requestId || !mpvRequests.has(requestId)) continue;
    const pending = mpvRequests.get(requestId);
    mpvRequests.delete(requestId);
    pending.resolve(fields.slice(1));
  }
}
function handleMpvFrames(chunk) {
  mpvFrameBuffer = Buffer.concat([mpvFrameBuffer, chunk]);
  while (mpvFrameBuffer.length >= 12) {
    const width = mpvFrameBuffer.readUInt32LE(0);
    const height = mpvFrameBuffer.readUInt32LE(4);
    const size = mpvFrameBuffer.readUInt32LE(8);
    if (!width || !height || size !== width * height * 4 || size > 16 * 1024 * 1024) {
      mpvFrameBuffer = Buffer.alloc(0);
      return;
    }
    if (mpvFrameBuffer.length < 12 + size) return;
    const pixels = mpvFrameBuffer.subarray(12, 12 + size);
    if (win && !win.isDestroyed()) win.webContents.send('mpv:frame', { width, height, pixels });
    mpvFrameBuffer = mpvFrameBuffer.subarray(12 + size);
  }
}
function mpvCommand(command, ...args) {
  if (!mpvProcess?.stdin?.writable) return Promise.reject(new Error('MPV preview is not running.'));
  const requestId = ++mpvRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      mpvRequests.delete(requestId);
      reject(new Error('MPV did not respond.'));
    }, 3000);
    mpvRequests.set(requestId, {
      resolve: value => { clearTimeout(timeout); resolve(value); },
      reject: error => { clearTimeout(timeout); reject(error); }
    });
    mpvProcess.stdin.write(`${[command, requestId, ...args].join('\t')}\n`);
  });
}
function setMpvBounds(bounds) {
  if (!mpvProcess?.stdin?.writable) return;
  mpvCommand('bounds', Math.round(bounds.x || 0), Math.round(bounds.y || 0), Math.round(bounds.width || 1), Math.round(bounds.height || 1)).catch(() => {});
}
async function setMpvAudioMix(requestedAdjustments) {
  const adjustments = (Array.isArray(requestedAdjustments) ? requestedAdjustments : [])
    .map(adjustment => ({
      index: Number(adjustment?.index),
      volume: Math.min(2, Math.max(0, Number(adjustment?.volume) || 0))
    }))
    .filter(adjustment => Number.isInteger(adjustment.index) && adjustment.index >= 0 && adjustment.index < 32);
  if (!adjustments.length) return mpvCommand('audio-reset');
  const inputs = adjustments.map((adjustment, index) =>
    `[aid${adjustment.index + 1}]volume=${adjustment.volume.toFixed(2)}[live${index}]`);
  const output = adjustments.length === 1
    ? `[live0]anull[ao]`
    : `${adjustments.map((_, index) => `[live${index}]`).join('')}amix=inputs=${adjustments.length}:duration=longest:normalize=0[ao]`;
  const response = await mpvCommand('audio-mix', `${inputs.join(';')};${output}`);
  if (response[0] === 'error') throw new Error(response[1] || 'Could not update the live audio mix.');
  return true;
}
async function startMpvSession(filePath, bounds) {
  const target = validateRecordingPath(filePath);
  const persistentHost = path.join(persistentRuntimeRoot, 'libmpv', 'mpv-host.exe');
  const bundledHost = path.join(process.resourcesPath, 'libmpv', 'mpv-host.exe');
  const executable = app.isPackaged
    ? (isRuntimeReady(persistentRuntimeRoot) ? persistentHost : bundledHost)
    : path.join(__dirname, '..', 'vendor', 'libmpv', 'mpv-host.exe');
  if (!fs.existsSync(executable)) throw new Error('The native libmpv host is missing from this build.');
  closeMpvSession();
  const handle = win.getNativeWindowHandle();
  const parentId = handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
  mpvProcess = spawn(executable, [
    parentId, String(Math.round(bounds.x || 0)), String(Math.round(bounds.y || 0)),
    String(Math.round(bounds.width || 1)), String(Math.round(bounds.height || 1)), target
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: path.dirname(executable) });
  const child = mpvProcess;
  mpvBuffer = '';
  mpvFrameBuffer = Buffer.alloc(0);
  child.stdout.on('data', handleMpvFrames);
  child.stderr.on('data', handleMpvData);
  mpvProcess.once('exit', () => {
    if (mpvProcess !== child) return;
    mpvProcess = null;
  });
  let duration = 0;
  for (let attempt = 0; attempt < 40 && !duration; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!mpvProcess || child.exitCode != null) {
      throw new Error(`Native libmpv host exited with code ${child.exitCode}.`);
    }
    const status = await mpvCommand('status');
    duration = Number(status[1]) || 0;
  }
  return { duration };
}
async function mpvStatus() {
  if (!mpvProcess) return { running: false, duration: 0, currentTime: 0, paused: true };
  const status = await mpvCommand('status');
  return {
    running: true,
    duration: Number(status[1]) || 0,
    currentTime: Number(status[2]) || 0,
    paused: Number(status[3]) !== 0
  };
}
function availableTrimPath(sourcePath) {
  const extension = path.extname(sourcePath);
  const base = sourcePath.slice(0, -extension.length);
  let candidate = `${base}-trimmed${extension}`;
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = `${base}-trimmed-${suffix++}${extension}`;
  return candidate;
}
function availableMixedPath(sourcePath) {
  const extension = path.extname(sourcePath);
  const base = sourcePath.slice(0, -extension.length);
  let candidate = `${base}-mixed${extension}`;
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = `${base}-mixed-${suffix++}${extension}`;
  return candidate;
}
async function recordingAudioTracks(filePath) {
  const sourcePath = validateRecordingPath(filePath);
  const executable = ffmpegPath();
  if (!fs.existsSync(executable)) throw new Error('FFmpeg is missing from this Clips build.');
  const { stderr = '' } = await execFileAsync(executable, [
    '-hide_banner', '-i', sourcePath, '-t', '0', '-map', '0:a?', '-f', 'null', '-'
  ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  const tracks = [];
  let currentTrack = null;
  for (const line of stderr.split(/\r?\n/)) {
    if (/^Stream mapping:/.test(line)) break;
    const match = line.match(/^\s*Stream #0:(\d+)(?:\([^)]*\))?(?:\[[^\]]+\])?: Audio:\s*([^,]+)/);
    if (match) {
      currentTrack = { index: tracks.length, streamIndex: Number(match[1]), codec: match[2].trim(), label: `Audio track ${tracks.length + 1}`, kind: 'track' };
      tracks.push(currentTrack);
      continue;
    }
    const title = currentTrack && line.match(/^\s*title\s*:\s*(.+?)\s*$/i);
    if (title) {
      currentTrack.label = title[1];
      currentTrack.kind = title[1].toLowerCase() === 'combined' ? 'combined' : 'stem';
    } else if (/^\s*Stream #/.test(line)) {
      currentTrack = null;
    }
  }
  return tracks;
}
async function mixRecordingAudio(filePath, requestedAdjustments, replace) {
  const sourcePath = validateRecordingPath(filePath);
  const tracks = await recordingAudioTracks(sourcePath);
  if (!tracks.length) throw new Error('This clip has no audio tracks.');
  const adjustmentMap = new Map((Array.isArray(requestedAdjustments) ? requestedAdjustments : []).map(adjustment => [
    Number(adjustment?.index), Math.min(2, Math.max(0, Number(adjustment?.volume) || 0))
  ]));
  const volumeFor = track => adjustmentMap.has(track.index) ? adjustmentMap.get(track.index) : 1;
  const executable = ffmpegPath();
  const extension = path.extname(sourcePath);
  const outputPath = replace ? sourcePath : availableMixedPath(sourcePath);
  const temporaryPath = `${sourcePath.slice(0, -extension.length)}.mixing-${crypto.randomUUID()}${extension}`;
  const hasCombinedTrack = tracks.length > 1 && tracks[0].kind === 'combined';
  const editableTracks = hasCombinedTrack ? tracks.slice(1) : tracks;
  const filters = [];
  const audioMaps = [];
  const metadataArgs = [];
  if (hasCombinedTrack) {
    editableTracks.forEach((track, index) => {
      filters.push(`[0:a:${track.index}]volume=${volumeFor(track).toFixed(2)},asplit=2[mix${index}][stem${index}]`);
    });
    filters.push(`${editableTracks.map((_, index) => `[mix${index}]`).join('')}amix=inputs=${editableTracks.length}:duration=longest:normalize=0[combined]`);
    audioMaps.push('-map', '[combined]', ...editableTracks.flatMap((_, index) => ['-map', `[stem${index}]`]));
    ['Combined', ...editableTracks.map(track => track.label)].forEach((label, index) => {
      metadataArgs.push(`-metadata:s:a:${index}`, `title=${label}`);
    });
  } else {
    editableTracks.forEach((track, index) => {
      filters.push(`[0:a:${track.index}]volume=${volumeFor(track).toFixed(2)}[audio${index}]`);
      audioMaps.push('-map', `[audio${index}]`);
      metadataArgs.push(`-metadata:s:a:${index}`, `title=${track.label}`);
    });
  }
  const mapArgs = ['-map', '0', '-map', '-0:a', ...audioMaps];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [
        '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', '-y', '-i', sourcePath,
        '-filter_complex', filters.join(';'), ...mapArgs, '-map_metadata', '0', ...metadataArgs,
        '-disposition:a:0', 'default', '-c', 'copy', '-c:a', 'aac', '-b:a', '192k', temporaryPath
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let progressBuffer = '', errorText = '';
      child.stdout.on('data', chunk => {
        progressBuffer += chunk.toString();
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^progress=(continue|end)$/);
          if (match && win && !win.isDestroyed()) win.webContents.send('audio:mix-progress', { complete: match[1] === 'end' });
        }
      });
      child.stderr.on('data', chunk => { errorText += chunk.toString(); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `FFmpeg exited with code ${code}.`)));
    });
    if (replace) {
      const backupPath = `${sourcePath}.audio-backup`;
      fs.renameSync(sourcePath, backupPath);
      try {
        fs.renameSync(temporaryPath, sourcePath);
        fs.rmSync(backupPath, { force: true });
      } catch (error) {
        if (fs.existsSync(backupPath) && !fs.existsSync(sourcePath)) fs.renameSync(backupPath, sourcePath);
        throw error;
      }
    } else {
      fs.renameSync(temporaryPath, outputPath);
    }
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw new Error(error.stderr?.trim() || error.message || 'FFmpeg could not update this clip.');
  }
  thumbnailPromises.delete(sourcePath);
  return outputPath;
}
function normalizeTrimBitrate(value) {
  return ['6M', '12M', '18M'].includes(value) ? value : 'original';
}
async function trimRecording(filePath, startSeconds, endSeconds, requestedBitrate) {
  const sourcePath = validateRecordingPath(filePath);
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('Choose an end time after the start time.');
  }
  const executable = ffmpegPath();
  if (!fs.existsSync(executable)) throw new Error('FFmpeg is missing from this Clips build.');
  const outputPath = availableTrimPath(sourcePath);
  const duration = end - start;
  const bitrate = normalizeTrimBitrate(requestedBitrate ?? settings.trimBitrate);
  const codecArgs = bitrate === 'original'
    ? ['-map', '0:v:0', '-map', '0:a?', '-c', 'copy']
    : [
        '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast',
        '-b:v', bitrate, '-minrate', bitrate, '-maxrate', bitrate,
        '-bufsize', `${Number.parseInt(bitrate, 10) * 2}M`, '-x264-params', 'nal-hrd=cbr:force-cfr=1',
        '-c:a', 'aac', '-b:a', '192k'
      ];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [
        '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats',
        '-ss', String(start), '-i', sourcePath, '-t', String(duration),
        ...codecArgs, outputPath
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let progressBuffer = '', errorText = '';
      child.stdout.on('data', chunk => {
        progressBuffer += chunk.toString();
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          const match = line.match(/^out_time_us=(\d+)$/);
          if (match && win && !win.isDestroyed()) {
            const percent = Math.min(100, Number(match[1]) / 1000000 / duration * 100);
            win.webContents.send('trim:progress', { percent, seconds: Number(match[1]) / 1000000, duration });
          }
        }
      });
      child.stderr.on('data', chunk => { errorText += chunk.toString(); });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(errorText.trim() || `FFmpeg exited with code ${code}.`)));
    });
    if (win && !win.isDestroyed()) win.webContents.send('trim:progress', { percent: 100, seconds: duration, duration });
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw new Error(error.stderr?.trim() || 'FFmpeg could not trim this recording.');
  }
  return outputPath;
}
async function processes() {
  const script = `Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ClipsProcessWindow {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out ClipsWindowRect rect);
}
public struct ClipsWindowRect {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
'@
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  try {
    $processPath = $null
    try { $processPath = $_.Path } catch {}
    $windowClass = New-Object System.Text.StringBuilder 256
    [ClipsProcessWindow]::GetClassName($_.MainWindowHandle, $windowClass, 256) | Out-Null
    $windowRect = New-Object ClipsWindowRect
    $hasBounds = [ClipsProcessWindow]::GetWindowRect($_.MainWindowHandle, [ref]$windowRect)
    [pscustomobject]@{
      name = $_.ProcessName + '.exe'
      path = $processPath
      title = $_.MainWindowTitle
      windowClass = $windowClass.ToString()
      bounds = if ($hasBounds) { [pscustomobject]@{
        x = $windowRect.Left
        y = $windowRect.Top
        width = $windowRect.Right - $windowRect.Left
        height = $windowRect.Bottom - $windowRect.Top
      }} else { $null }
    }
  } catch {}
  } | Sort-Object name -Unique | ConvertTo-Json -Compress`;
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], { windowsHide: true }));
      return parseProcessList(stdout);
    } catch (error) {
      logger.warn('process list refresh attempt failed', { attempt, bytes: Buffer.byteLength(stdout || ''), message: error.message });
      if (attempt === 2) {
        logger.warn('process list refresh failed; retaining the previous snapshot', { applications: runningApps.length });
        return runningApps;
      }
    }
  }
  return runningApps;
}
async function monitor() {
  try {
    cleanupStorage();
    const running = await processes();
    runningApps = running;
    const wanted = new Set(settings.gameExecutables.map(x => x.toLowerCase()));
    activeGames = running.filter(p => wanted.has(p.name.toLowerCase())).map(p => p.name);
    if (!activeGames.length) {
      autoRecordSuppressed = false;
      lastGameDisplayId = null;
    }
    if (settings.autoRecord && activeGames.length && !autoRecordSuppressed) {
      clearTimeout(stopTimer); stopTimer = null;
      const status = await obs.status();
      if (status.recording && sessionDate && sessionDate !== todayKey()) {
        await obs.stopSession();
        await startSession();
      } else if (!status.recording) await startSession();
    } else if (settings.autoRecord && !activeGames.length && !stopTimer && (await obs.status()).recording) {
      stopTimer = setTimeout(async () => {
        stopTimer = null;
        if (!activeGames.length) {
          await obs.stopSession().catch(setError);
          sessionDate = '';
          await obs.disconnect().catch(() => {});
        }
      }, settings.stopDelaySeconds * 1000);
    }
    lastError = '';
  } catch (error) { setError(error); }
  broadcast();
  scheduleNextMonitor();
}
function setError(error) {
  lastError = error?.message || String(error);
  logger.error('application error', { message: lastError, stack: error?.stack });
  telemetry?.reportError(error).catch(() => {});
  broadcast();
}
async function tryConnect() {
  if (obs.connected) return true;
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    try {
      await runtimeSetupPromise;
      const executable = captureHostPath();
      if (!fs.existsSync(executable)) throw new Error('The bundled Clips capture engine is missing.');
      await obs.connect({
        executable,
        runtimeRoot: captureRuntimeRoot(),
        configRoot: path.join(app.getPath('userData'), 'capture-host'),
        settings
      });
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
async function state() { return { settings, obs: await obs.status(), activeGames, autoRecordSuppressed, recordings: recentRecordings(), archivedRecordings: archivedRecordings(), lastError, lastClip, captureEngineInstalled: fs.existsSync(captureHostPath()), app: { version: displayVersion(app.getVersion()), buildTime: buildInfo.buildTime, runtimeVersion: RUNTIME_VERSION, runtimeReady: app.isPackaged ? isRuntimeReady(persistentRuntimeRoot) : fs.existsSync(captureHostPath()), changelog }, telemetry: { configured: !!telemetryEndpoint, mode: settings.telemetryMode }, update: updateState }; }

async function collectSystemInformation() {
  let gpu = 'Unknown';
  try {
    const info = await app.getGPUInfo('basic');
    gpu = info.gpuDevice?.find(device => device.active)?.deviceString || info.gpuDevice?.[0]?.deviceString || 'Unknown';
  } catch {}
  return {
    platform: process.platform,
    architecture: process.arch,
    windowsRelease: os.release(),
    cpu: os.cpus()[0]?.model || 'Unknown',
    gpu,
    ramGiB: Math.round(os.totalmem() / 1024 ** 3)
  };
}

async function requestTelemetryPreference() {
  if (!telemetryEndpoint || settings.telemetryMode !== 'pending') return;
  const result = await dialog.showMessageBox({
    type: 'question',
    title: 'Help improve Clips?',
    message: 'Choose what Clips may send',
    detail: 'Diagnostics sends anonymous system specs and a sanitized log excerpt only when an error occurs. Version only sends a random installation ID and Clips/runtime versions. You can change this later in Settings.',
    buttons: ['Diagnostics and error logs', 'Version only', 'Nothing'],
    defaultId: 1,
    cancelId: 2,
    noLink: true
  });
  settings.telemetryMode = ['diagnostics', 'version', 'off'][result.response] || 'off';
  persist();
}

function configureTelemetry({ sendStartup = false } = {}) {
  telemetry = null;
  if (!telemetryEndpoint || !['diagnostics', 'version'].includes(settings.telemetryMode)) return;
  const installationId = loadInstallationId(path.join(app.getPath('userData'), 'telemetry.json'));
  telemetry = createTelemetry({
    endpoint: telemetryEndpoint,
    mode: settings.telemetryMode,
    installationId,
    appVersion: app.getVersion(),
    runtimeVersion: RUNTIME_VERSION,
    system: systemInformation,
    logger,
    redact: [app.getPath('userData'), os.homedir(), settings.recordingsFolder]
  });
  if (sendStartup) telemetry.sendStartup().catch(() => {});
}
function trayIcon(recording) {
  return nativeImage.createFromBuffer(trayIconPng(recording));
}
function updateTray(recording) {
  if (tray && !tray.isDestroyed()) {
    tray.setImage(trayIcon(recording));
    tray.setToolTip(recording ? 'jss/clips — Recording' : 'jss/clips');
  }
  if (win && !win.isDestroyed()) win.setIcon(nativeImage.createFromBuffer(trayIconPng(recording, 256)));
}
function showMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
async function broadcast() {
  const currentState = await state();
  updateTray(currentState.obs.recording);
  if (win && !win.isDestroyed()) win.webContents.send('state', currentState);
}
function setUpdateState(next) {
  updateState = { ...updateState, ...next, ...(next.version ? { version: displayVersion(next.version) } : {}) };
  broadcast().catch(() => {});
}
function updateFeedUrl() {
  if (process.env.CLIPS_UPDATE_URL) return String(process.env.CLIPS_UPDATE_URL).trim().replace(/\/+$/, '');
  const configuredUrl = DEFAULT_UPDATE_URL.trim().replace(/\/+$/, '');
  if (!app.isPackaged) return '';
  return settings?.nightlyUpdates ? configuredUrl : `${configuredUrl}/stable`;
}
function configureUpdates() {
  clearTimeout(updateCheckTimeout);
  clearInterval(updateCheckTimer);
  updateCheckTimeout = null;
  updateCheckTimer = null;
  stagedUpdater = null;
  const generation = ++updateConfigurationGeneration;
  updateState = {
    status: 'idle',
    version: displayVersion(app.getVersion()),
    percent: 0,
    message: '',
    configured: false
  };
  if (process.env.CLIPS_UPDATE_MOCK === '1') {
    updateState.configured = true;
    updateCheckTimeout = setTimeout(() => {
      if (generation === updateConfigurationGeneration) setUpdateState({
        status: 'ready',
        version: `${app.getVersion()}-local`,
        percent: 100,
        message: 'Local update ready'
      });
    }, 900);
    return;
  }
  if (!app.isPackaged) return;
  const updateUrl = updateFeedUrl();
  if (!updateUrl) return;
  updateState.configured = true;
  stagedUpdater = createStagedUpdater({
    app,
    feedUrl: updateUrl,
    onState: next => {
      if (generation === updateConfigurationGeneration) setUpdateState(next);
    }
  });
  const check = () => stagedUpdater.check();
  updateCheckTimeout = setTimeout(check, 3000);
  updateCheckTimer = setInterval(check, 15 * 60 * 1000);
}
function monitorDelayMs() {
  const configured = Math.max(2, Number(settings.pollSeconds) || 5) * 1000;
  return activeGames.length || obs.lastStatus.recording ? configured : Math.max(10000, configured);
}
function scheduleNextMonitor() {
  clearTimeout(monitorTimer);
  monitorTimer = setTimeout(monitor, monitorDelayMs());
}
function scheduleMonitor() {
  clearTimeout(monitorTimer);
  monitorTimer = null;
  monitor();
}
function registerHotkey() { globalShortcut.unregisterAll(); if (settings.clipHotkey) globalShortcut.register(settings.clipHotkey, () => saveClip()); }
async function saveClip() { try { await obs.saveClip(); lastClip = new Date().toISOString(); lastError = ''; showOverlayToast('Clip saved', 'clip-saved'); } catch (e) { setError(e); } broadcast(); }

let lastGameDisplayId = null;
function overlayDisplay() {
  const wanted = new Set(activeGames.map(name => name.toLowerCase()));
  const gameWindow = runningApps
    .filter(item => wanted.has(item.name.toLowerCase()) && item.bounds
      && Number.isFinite(item.bounds.x) && Number.isFinite(item.bounds.y)
      && item.bounds.x > -30000 && item.bounds.y > -30000
      && item.bounds.width > 0 && item.bounds.height > 0)
    .sort((a, b) => (b.bounds.width * b.bounds.height) - (a.bounds.width * a.bounds.height))[0];
  if (gameWindow) {
    const display = screen.getDisplayMatching(gameWindow.bounds);
    lastGameDisplayId = display.id;
    return display;
  }
  if (activeGames.length && lastGameDisplayId != null) {
    const previousDisplay = screen.getAllDisplays().find(display => display.id === lastGameDisplayId);
    if (previousDisplay) return previousDisplay;
  }
  return screen.getPrimaryDisplay();
}
function positionOverlayWindow() {
  if (!toastWin || toastWin.isDestroyed()) return;
  const display = overlayDisplay();
  const [width] = toastWin.getSize();
  toastWin.setPosition(
    Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    display.bounds.y,
    false
  );
  return display;
}
function reinforceOverlayTopmost() {
  if (!toastWin || toastWin.isDestroyed()) return;
  toastWin.setAlwaysOnTop(true, 'screen-saver', 1);
  toastWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (toastWin.isVisible()) toastWin.moveTop();
}
function displayOverlayToast(toast) {
  if (!toastWin || toastWin.isDestroyed() || !toastReady) { pendingToast = toast; return; }
  clearTimeout(toastHideTimer);
  const display = positionOverlayWindow();
  reinforceOverlayTopmost();
  toastWin.showInactive();
  reinforceOverlayTopmost();
  toastWin.webContents.send('toast:show', toast);
  logger.info('overlay toast shown', { kind: toast.kind, displayId: display?.id, bounds: toastWin.getBounds(), alwaysOnTop: toastWin.isAlwaysOnTop() });
  const visibleDuration = toast.kind === 'recording' || toast.kind === 'recording-stopped' ? 1350 : 1000;
  toastHideTimer = setTimeout(() => {
    if (!toastWin || toastWin.isDestroyed()) return;
    toastWin.webContents.send('toast:hide');
  }, visibleDuration);
}
function showOverlayToast(message, kind) { displayOverlayToast({ message, kind }); }
function recoverOverlayWindow(reason, failedWindow = toastWin) {
  if (failedWindow !== toastWin) return;
  logger.warn('overlay window recovery scheduled', { reason });
  toastReady = false;
  clearTimeout(toastRecoveryTimer);
  if (toastWin && !toastWin.isDestroyed()) toastWin.destroy();
  if (app.isQuitting) return;
  toastRecoveryTimer = setTimeout(() => {
    toastRecoveryTimer = null;
    if (!toastWin || toastWin.isDestroyed()) createOverlayWindow();
  }, 250);
}
function createOverlayWindow() {
  clearTimeout(toastRecoveryTimer);
  toastRecoveryTimer = null;
  const overlayWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 140,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  toastWin = overlayWindow;
  toastWin.setIgnoreMouseEvents(true);
  reinforceOverlayTopmost();
  toastWin.webContents.on('did-finish-load', () => {
    toastReady = true;
    logger.info('overlay window ready', { bounds: toastWin.getBounds(), alwaysOnTop: toastWin.isAlwaysOnTop() });
    if (pendingToast) { const toast = pendingToast; pendingToast = null; displayOverlayToast(toast); }
  });
  toastWin.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) recoverOverlayWindow(`load failed (${code} ${description}) for ${url}`, overlayWindow);
  });
  toastWin.webContents.on('render-process-gone', (_event, details) => recoverOverlayWindow(`renderer exited (${details.reason}, code ${details.exitCode})`, overlayWindow));
  toastWin.on('unresponsive', () => recoverOverlayWindow('renderer became unresponsive', overlayWindow));
  toastWin.on('closed', () => {
    if (toastWin === overlayWindow) { toastWin = null; toastReady = false; }
  });
  toastWin.loadFile(path.join(__dirname, 'overlay.html')).catch(error => recoverOverlayWindow(`load rejected: ${error.message}`, overlayWindow));
}

const titleBarAppearance = {
  normal: { color: '#0a0a0a', symbolColor: '#a1a1aa', height: 52 },
  modal: { color: '#030303', symbolColor: '#3f3f42', height: 52 }
};

function createWindow() {
  const hidden = process.argv.includes('--hidden');
  win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'assets', 'app-icon.ico'),
    show: !hidden,
    width: 1160,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#0a0a0a',
    title: 'jss/clips',
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarAppearance.normal,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.setMenuBarVisibility(false); win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', e => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

app.whenReady().then(async () => {
  systemInformation = await collectSystemInformation();
  logger.info('system information', systemInformation);
  settings = loadSettings();
  loadFavorites();
  persist();
  logger.info('application ready', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    settingsPath: settingsPath(),
    recordingsFolder: settings.recordingsFolder,
    microphoneDeviceId: settings.microphoneDeviceId
  });
  await requestTelemetryPreference();
  configureTelemetry({ sendStartup: true });
  app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] });
  createWindow(); createOverlayWindow(); registerHotkey(); configureUpdates();
  if (app.isPackaged) {
    runtimeSetupPromise = ensureRuntimeInstalled(process.resourcesPath, persistentRuntimeRoot)
      .then(stopLegacyBundledObs)
      .then(() => broadcast())
      .catch(error => setError(new Error(`Media runtime setup failed: ${error.message}`)));
  }
  scheduleMonitor();
  tray = new Tray(trayIcon(false)); tray.setToolTip('jss/clips'); tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open jss/clips', click: showMainWindow }, { label: 'Save clip', click: saveClip }, { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', showMainWindow);
  broadcast();
});
app.on('second-instance', showMainWindow);
process.on('uncaughtExceptionMonitor', error => { logger.error('uncaught exception', { message: error.message, stack: error.stack }); telemetry?.reportError(error).catch(() => {}); });
process.on('unhandledRejection', error => { logger.error('unhandled rejection', { message: error?.message || String(error), stack: error?.stack }); telemetry?.reportError(error).catch(() => {}); });
app.on('will-quit', () => { logger.info('application quitting'); if (microphoneVolumePersistTimer) persist(); logger.maintain(); clearTimeout(toastHideTimer); clearTimeout(toastRecoveryTimer); clearTimeout(microphoneVolumePersistTimer); clearTimeout(monitorTimer); clearTimeout(updateCheckTimeout); clearInterval(updateCheckTimer); obs.disconnect().catch(() => {}); closeMpvSession(); mediaServer?.close(); globalShortcut.unregisterAll(); });

ipcMain.handle('state:get', state);
ipcMain.handle('update:install', async () => {
  if (updateState.status !== 'ready') return false;
  if (process.env.CLIPS_UPDATE_MOCK === '1' && !app.isPackaged) {
    app.isQuitting = true;
    app.relaunch();
    app.exit(0);
    return true;
  }
  return stagedUpdater?.restart() || false;
});
ipcMain.handle('update:check', () => {
  if (!app.isPackaged || !updateFeedUrl()) return false;
  stagedUpdater?.check();
  return true;
});
ipcMain.handle('hotkey:capture-start', () => {
  globalShortcut.unregisterAll();
  return true;
});
ipcMain.handle('hotkey:capture-cancel', () => {
  registerHotkey();
  return true;
});
ipcMain.handle('capture:connect', async () => {
  try {
    const current = await obs.status();
    if (current.recording) throw new Error('Stop recording before reconnecting the capture engine.');
    if (obs.connected) await obs.disconnect();
    await tryConnect();
    // Reconnecting is a health check while idle; do not leave libobs video/GPU
    // resources alive until an actual recording session needs them.
    if (obs.connected && !activeGames.length) await obs.disconnect();
  } catch (error) {
    setError(error);
  }
  return state();
});
ipcMain.handle('settings:save', async (_e, next) => {
  const previous = settings;
  let settingsCommitted = false;
  clearTimeout(stopTimer); stopTimer = null;
  clearTimeout(monitorTimer);
  try {
    const updated = normalizeSettingsUpdate(previous, next);
    ensureDirectory(updated.recordingsFolder);
    const nightlyUpdatesChanged = updated.nightlyUpdates !== previous.nightlyUpdates;
    const telemetryModeChanged = updated.telemetryMode !== previous.telemetryMode;
    const recordingSettingsChanged = ['obsRecordingQuality', 'obsResolution', 'obsFps', 'obsFormat', 'clipLengthSeconds']
      .some(key => updated[key] !== previous[key]);
    const microphoneVolumeChanged = updated.microphoneVolumePercent !== previous.microphoneVolumePercent;
    const microphoneNoiseGateChanged = updated.microphoneNoiseGateDb !== previous.microphoneNoiseGateDb;
    const microphoneNvidiaNoiseRemovalChanged = updated.microphoneNvidiaNoiseRemoval !== previous.microphoneNvidiaNoiseRemoval;
    const currentCapture = await obs.status();
    const restartCapture = (currentCapture.recording || currentCapture.replayBuffer)
      && captureRestartRequired(previous, updated);
    if (restartCapture) {
      logger.info('restarting capture to apply settings', {
        previousFolder: previous.recordingsFolder,
        recordingsFolder: updated.recordingsFolder,
        previousMicrophone: previous.microphoneDeviceId,
        microphoneDeviceId: updated.microphoneDeviceId
      });
      await obs.stopSession();
      sessionDate = '';
    }
    settings = updated;
    persist();
    settingsCommitted = true;
    logger.info('settings saved', {
      recordingsFolder: settings.recordingsFolder,
      microphoneDeviceId: settings.microphoneDeviceId,
      restartCapture
    });
    app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows, args: ['--hidden'] });
    registerHotkey();
    if (nightlyUpdatesChanged) configureUpdates();
    if (telemetryModeChanged) configureTelemetry({ sendStartup: true });
    if (obs.connected && recordingSettingsChanged) {
      await obs.applyRecordingSettings({
        quality: settings.obsRecordingQuality,
        resolution: settings.obsResolution,
        fps: settings.obsFps,
        format: settings.obsFormat,
        clipLengthSeconds: settings.clipLengthSeconds
      });
    }
    if (obs.connected && microphoneVolumeChanged) {
      await obs.setMicrophoneVolume(settings.microphoneVolumePercent);
    }
    if (obs.connected && microphoneNoiseGateChanged) {
      await obs.setMicrophoneNoiseGate(settings.microphoneNoiseGateDb);
    }
    if (obs.connected && microphoneNvidiaNoiseRemovalChanged) {
      await obs.setMicrophoneNvidiaNoiseRemoval(settings.microphoneNvidiaNoiseRemoval);
    }
    if (restartCapture) await startSession();
    lastError = '';
  } catch (error) {
    if (!settingsCommitted) settings = previous;
    setError(error);
  } finally {
    scheduleMonitor();
  }
  return state();
});
ipcMain.handle('recording:toggle', async () => {
  try {
    const output = await obs.status();
    if (output.recording) {
      autoRecordSuppressed = activeGames.length > 0;
      await obs.stopSession();
      sessionDate = '';
      await obs.disconnect();
      showOverlayToast('Recording stopped', 'recording-stopped');
    } else {
      autoRecordSuppressed = false;
      await startSession();
    }
  } catch (error) { setError(error); }
  return state();
});
ipcMain.handle('clip:save', async () => { await saveClip(); return state(); });
ipcMain.handle('folder:open', () => shell.openPath(todayFolder()));
ipcMain.handle('folder:open-root', () => { ensureDirectory(settings.recordingsFolder); return shell.openPath(settings.recordingsFolder); });
ipcMain.handle('recording:open', async (_event, filePath) => {
  const target = validateRecordingPath(filePath);
  const executable = mpvPath();
  if (!executable) throw new Error('Bundled MPV is missing from this Clips build.');
  spawn(executable, ['--force-window=yes', target], { detached: true, windowsHide: false, stdio: 'ignore' }).unref();
});
ipcMain.handle('recording:thumbnail', (_event, filePath) => recordingThumbnail(filePath));
ipcMain.handle('recording:favorite', async (_event, filePath, favorite) => {
  const target = validateRecordingPath(filePath);
  const key = recordingKey(target);
  if (favorite) favoriteRecordingKeys.add(key); else favoriteRecordingKeys.delete(key);
  persistFavorites();
  await broadcast();
  return state();
});
ipcMain.handle('recording:delete', async (_event, filePaths) => {
  const targets = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths]).map(validateRecordingPath))];
  const captureStatus = await obs.status();
  if (captureStatus.recording && targets.some(target => path.dirname(target) === path.join(settings.recordingsFolder, todayKey()) && isRawRecordingName(path.basename(target)))) {
    throw new Error('Stop the active recording before deleting today\'s full recording.');
  }
  for (const target of targets) {
    fs.rmSync(target, { force: true });
    favoriteRecordingKeys.delete(recordingKey(target));
    thumbnailPromises.delete(target);
    for (const [token, entry] of mediaTokens) if (entry.sourcePath === target) mediaTokens.delete(token);
  }
  persistFavorites();
  await broadcast();
  return state();
});
ipcMain.handle('mpv:start', (_event, filePath, bounds) => startMpvSession(filePath, bounds));
ipcMain.handle('mpv:bounds', (_event, bounds) => setMpvBounds(bounds));
ipcMain.handle('mpv:status', () => mpvStatus());
ipcMain.handle('mpv:seek', (_event, seconds) => mpvCommand('seek', Math.max(0, Number(seconds) || 0)));
ipcMain.handle('mpv:toggle', () => mpvCommand('toggle'));
ipcMain.handle('mpv:pause', (_event, paused = true) => mpvCommand('pause', paused ? 1 : 0));
ipcMain.handle('mpv:volume', (_event, volume) => mpvCommand('volume', Math.min(100, Math.max(0, Number(volume) || 0))));
ipcMain.handle('mpv:audio-mix', (_event, adjustments) => setMpvAudioMix(adjustments));
ipcMain.handle('mpv:close', () => closeMpvSession());
ipcMain.handle('mpv:fullscreen', (_event, filePath) => {
  const target = validateRecordingPath(filePath);
  const executable = mpvPath();
  if (!executable) throw new Error('Bundled MPV is missing from this Clips build.');
  const fullscreenPlayer = spawn(executable, mpvFullscreenArgs(mpvFullscreenScriptPath(), target), {
    detached: true,
    windowsHide: false,
    stdio: 'ignore'
  });
  fullscreenPlayer.once('exit', showMainWindow);
  fullscreenPlayer.unref();
  return true;
});
ipcMain.handle('capture:microphones', async () => {
  const wasConnected = obs.connected;
  if (!wasConnected && !await tryConnect()) return [];
  try { return await obs.microphones(); }
  finally {
    if (!wasConnected && !obs.lastStatus.recording) await obs.disconnect().catch(() => {});
  }
});
ipcMain.on('capture:microphone-volume-set', (_event, requestedPercent) => {
  const percent = Math.min(200, Math.max(0, Math.round(Number(requestedPercent) || 0)));
  settings = { ...settings, microphoneVolumePercent: percent };
  clearTimeout(microphoneVolumePersistTimer);
  microphoneVolumePersistTimer = setTimeout(() => {
    microphoneVolumePersistTimer = null;
    persist();
    logger.info('microphone volume persisted', { microphoneVolumePercent: percent });
  }, 120);
  logger.info('microphone volume input', { microphoneVolumePercent: percent });
  obs.setMicrophoneVolume(percent)
    .then(() => { lastError = ''; })
    .catch(setError);
});
ipcMain.on('capture:microphone-noise-gate-set', (_event, requestedDb) => {
  const thresholdDb = Math.min(-5, Math.max(-60, Math.round(Number(requestedDb) || -40)));
  settings = { ...settings, microphoneNoiseGateDb: thresholdDb };
  clearTimeout(microphoneVolumePersistTimer);
  microphoneVolumePersistTimer = setTimeout(() => { microphoneVolumePersistTimer = null; persist(); }, 120);
  obs.setMicrophoneNoiseGate(thresholdDb).catch(setError);
});
ipcMain.handle('capture:microphone-level', async () => obs.microphoneLevel());
ipcMain.on('capture:microphone-nvidia-noise-removal-set', (_event, enabled) => {
  settings = { ...settings, microphoneNvidiaNoiseRemoval: !!enabled };
  persist();
  obs.setMicrophoneNvidiaNoiseRemoval(!!enabled).catch(setError);
});
ipcMain.on('renderer:log', (_event, level, message) => {
  const write = level === 'error' ? logger.error : logger.warn;
  write('renderer event', { message: String(message || '') });
});
ipcMain.handle('window:modal-appearance', (event, active) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow === win) senderWindow.setTitleBarOverlay(active ? titleBarAppearance.modal : titleBarAppearance.normal);
});
ipcMain.handle('recording:trim', async (_event, filePath, startSeconds, endSeconds, bitrate) => {
  const outputPath = await trimRecording(filePath, startSeconds, endSeconds, bitrate);
  return { outputPath, state: await state() };
});
ipcMain.handle('recording:audio-tracks', (_event, filePath) => recordingAudioTracks(filePath));
ipcMain.handle('recording:audio-mix', async (_event, filePath, adjustments, replace) => {
  const target = validateRecordingPath(filePath);
  const captureStatus = await obs.status();
  if (replace && captureStatus.recording && path.dirname(target) === path.join(settings.recordingsFolder, todayKey()) && isRawRecordingName(path.basename(target))) {
    throw new Error('Stop the active recording before saving audio changes to it. You can still save a new clip.');
  }
  const outputPath = await mixRecordingAudio(target, adjustments, !!replace);
  await broadcast();
  return { outputPath, state: await state() };
});
ipcMain.handle('folder:choose', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('logs:open', () => shell.showItemInFolder(logger.filePath));
ipcMain.handle('processes:list', processes);
