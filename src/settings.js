const path = require('path');
const fs = require('fs');

const QUALITIES = ['HQ', 'Small', 'Lossless', 'Stream'];
const RESOLUTIONS = ['2560x1440', '1920x1080', '1280x720'];
const FORMATS = ['mkv', 'mp4', 'mov', 'flv'];
const TELEMETRY_MODES = ['diagnostics', 'version', 'off', 'pending'];
const TRIM_BITRATES = ['original', '6M', '12M', '18M'];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boundedNumber = (value, fallback, minimum, maximum) => Math.min(maximum, Math.max(minimum, finiteNumber(value, fallback)));
const boundedInteger = (value, fallback, minimum, maximum) => Math.round(boundedNumber(value, fallback, minimum, maximum));
const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const cleanString = (value, fallback = '', maximum = 512) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum)
  : fallback;
const stringList = (value, fallback = []) => {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.map(item => cleanString(item, '', 260)).filter(Boolean))];
};
const HOTKEY_MODIFIERS = new Set(['CommandOrControl', 'Command', 'Cmd', 'Control', 'Ctrl', 'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta']);
const HOTKEY_KEYS = new Set(['Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Escape', 'Esc', 'Plus']);
const validHotkeyKey = token => token.length === 1 || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(token) || HOTKEY_KEYS.has(token);
const hotkey = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const cleaned = cleanString(value, '', 128);
  if (!cleaned) return '';
  const tokens = cleaned.split('+');
  if (tokens.some(token => !token) || !validHotkeyKey(tokens.at(-1)) || tokens.slice(0, -1).some(token => !HOTKEY_MODIFIERS.has(token))) return fallback;
  return cleaned;
};

function normalizeGameProfiles(value) {
  if (!isRecord(value)) return {};
  const profiles = {};
  for (const [rawExecutable, rawProfile] of Object.entries(value)) {
    const executable = cleanString(rawExecutable, '', 260).toLowerCase();
    if (!executable || !isRecord(rawProfile)) continue;
    const profile = rawProfile;
    profiles[executable] = {
      quality: choice(profile.quality, QUALITIES, ''),
      resolution: choice(profile.resolution, RESOLUTIONS, ''),
      fps: choice(finiteNumber(profile.fps, 0), [30, 60], 0),
      clipLengthSeconds: profile.clipLengthSeconds == null || profile.clipLengthSeconds === ''
        ? 0
        : boundedInteger(profile.clipLengthSeconds, 0, 5, 3600),
      microphoneDeviceId: cleanString(profile.microphoneDeviceId, '', 512),
      // Missing means "inherit the global list"; an explicit empty array means
      // "capture no additional applications" for this profile.
      audioExecutables: Array.isArray(profile.audioExecutables) ? stringList(profile.audioExecutables) : undefined
    };
  }
  return profiles;
}

function normalizeSettings(defaults, input, { requireFolder = false } = {}) {
  const source = isRecord(input) ? input : {};
  const fallback = isRecord(defaults) ? defaults : {};
  const requestedFolder = cleanString(source.recordingsFolder, cleanString(fallback.recordingsFolder));
  if (requireFolder && !requestedFolder) throw new Error('Choose a storage folder.');
  const recordingsFolder = requestedFolder ? path.resolve(requestedFolder) : '';

  return {
    recordingsFolder,
    retentionDays: boundedInteger(source.retentionDays, fallback.retentionDays ?? 1, 1, 3650),
    storageCleanupMode: choice(source.storageCleanupMode, ['days', 'disk'], fallback.storageCleanupMode || 'disk'),
    maxDiskUsagePercent: boundedNumber(source.maxDiskUsagePercent, fallback.maxDiskUsagePercent ?? 80, 1, 99),
    maxRawRecordingGigabytes: boundedNumber(source.maxRawRecordingGigabytes, fallback.maxRawRecordingGigabytes ?? 250, 1, 100000),
    gameExecutables: stringList(source.gameExecutables, fallback.gameExecutables),
    ignoredGameExecutables: stringList(source.ignoredGameExecutables, fallback.ignoredGameExecutables),
    audioExecutables: stringList(source.audioExecutables, fallback.audioExecutables),
    autoRecord: boolean(source.autoRecord, fallback.autoRecord !== false),
    startWithWindows: boolean(source.startWithWindows, fallback.startWithWindows !== false),
    clipHotkey: hotkey(source.clipHotkey, fallback.clipHotkey || ''),
    markerHotkey: hotkey(source.markerHotkey, fallback.markerHotkey || ''),
    gameProfiles: normalizeGameProfiles(source.gameProfiles),
    pollSeconds: boundedNumber(source.pollSeconds, fallback.pollSeconds ?? 5, 2, 3600),
    stopDelaySeconds: boundedNumber(source.stopDelaySeconds, fallback.stopDelaySeconds ?? 20, 0, 3600),
    clipLengthSeconds: boundedInteger(source.clipLengthSeconds, fallback.clipLengthSeconds ?? 60, 5, 3600),
    instantReplay: boolean(source.instantReplay, fallback.instantReplay === true),
    instantReplayLengthSeconds: boundedInteger(source.instantReplayLengthSeconds, fallback.instantReplayLengthSeconds ?? 300, 5, 3600),
    obsRecordingQuality: choice(source.obsRecordingQuality, QUALITIES, fallback.obsRecordingQuality || 'HQ'),
    obsResolution: choice(source.obsResolution, RESOLUTIONS, fallback.obsResolution || '1920x1080'),
    obsFps: choice(finiteNumber(source.obsFps, fallback.obsFps ?? 60), [30, 60], fallback.obsFps || 60),
    obsFormat: choice(source.obsFormat, FORMATS, fallback.obsFormat || 'mkv'),
    microphoneDeviceId: cleanString(source.microphoneDeviceId, fallback.microphoneDeviceId || 'disabled'),
    microphoneVolumePercent: boundedNumber(source.microphoneVolumePercent, fallback.microphoneVolumePercent ?? 100, 0, 200),
    microphoneNoiseGateDb: boundedNumber(source.microphoneNoiseGateDb, fallback.microphoneNoiseGateDb ?? -40, -60, -5),
    microphoneNvidiaNoiseRemoval: boolean(source.microphoneNvidiaNoiseRemoval, fallback.microphoneNvidiaNoiseRemoval !== false),
    trimBitrate: choice(source.trimBitrate, TRIM_BITRATES, fallback.trimBitrate || 'original'),
    desktopWindow: boolean(source.desktopWindow, fallback.desktopWindow !== false),
    nightlyUpdates: boolean(source.nightlyUpdates, fallback.nightlyUpdates === true),
    telemetryMode: choice(source.telemetryMode, TELEMETRY_MODES, fallback.telemetryMode || 'pending')
  };
}

function normalizeStoredSettings(defaults, saved) {
  const migrated = isRecord(saved) ? { ...saved } : {};
  if (migrated.clipLengthSeconds == null) migrated.clipLengthSeconds = Number(migrated.stopDelaySeconds) || defaults.clipLengthSeconds;
  return normalizeSettings(defaults, migrated);
}

function loadSettingsFile({ currentPath, legacyPath, defaults, fsModule = fs, now = () => new Date() }) {
  const sourcePath = fsModule.existsSync(currentPath) ? currentPath : (fsModule.existsSync(legacyPath) ? legacyPath : '');
  if (!sourcePath) return { settings: { ...defaults }, warning: '', persistenceBlocked: false, sourcePath: '' };
  try {
    const saved = JSON.parse(fsModule.readFileSync(sourcePath, 'utf8'));
    if (!isRecord(saved)) throw new Error('the file does not contain a settings object');
    return { settings: normalizeStoredSettings(defaults, saved), warning: '', persistenceBlocked: false, sourcePath };
  } catch (error) {
    const suffix = now().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${sourcePath}.corrupt-${suffix}`;
    try {
      fsModule.renameSync(sourcePath, backupPath);
      return {
        settings: { ...defaults },
        warning: `Clips could not read your settings and restored safe defaults. The original file was preserved at ${backupPath}.`,
        persistenceBlocked: false,
        sourcePath,
        backupPath,
        error
      };
    } catch (backupError) {
      return {
        settings: { ...defaults },
        warning: `Clips could not read your settings. The original file was left untouched at ${sourcePath}; settings will not be overwritten during startup.`,
        persistenceBlocked: true,
        sourcePath,
        backupPath,
        error,
        backupError
      };
    }
  }
}

function normalizeSettingsUpdate(current, next) {
  if (!isRecord(next)) throw new Error('Settings must be an object.');
  return normalizeSettings(current, { ...current, ...next }, { requireFolder: true });
}

function changed(left, right, key) {
  return JSON.stringify(left[key]) !== JSON.stringify(right[key]);
}

function captureRestartRequired(previous, next) {
  return [
    'recordingsFolder',
    'microphoneDeviceId',
    'audioExecutables',
    'obsRecordingQuality',
    'obsResolution',
    'obsFps',
    'obsFormat',
    'clipLengthSeconds'
  ].some(key => changed(previous, next, key));
}

module.exports = { loadSettingsFile, normalizeStoredSettings, normalizeSettingsUpdate, captureRestartRequired };
