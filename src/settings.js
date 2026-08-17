const path = require('path');

function normalizeSettingsUpdate(current, next) {
  const finiteNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  const requestedFolder = String(next.recordingsFolder || '').trim();
  if (!requestedFolder) throw new Error('Choose a storage folder.');
  const gameProfiles = Object.fromEntries(Object.entries(next.gameProfiles || {}).map(([executable, profile]) => [String(executable).toLowerCase(), {
    quality: ['HQ', 'Small', 'Lossless', 'Stream'].includes(profile?.quality) ? profile.quality : '',
    resolution: ['2560x1440', '1920x1080', '1280x720'].includes(profile?.resolution) ? profile.resolution : '',
    fps: [30, 60].includes(Number(profile?.fps)) ? Number(profile.fps) : 0,
    clipLengthSeconds: profile?.clipLengthSeconds ? Math.max(5, Math.min(3600, finiteNumber(profile.clipLengthSeconds, 0))) : 0,
    microphoneDeviceId: String(profile?.microphoneDeviceId || ''),
    audioExecutables: Array.isArray(profile?.audioExecutables) ? profile.audioExecutables.map(String) : undefined
  }]));
  return {
    ...current,
    ...next,
    recordingsFolder: path.resolve(requestedFolder),
    retentionDays: Math.max(1, finiteNumber(next.retentionDays, current.retentionDays || 1)),
    storageCleanupMode: next.storageCleanupMode === 'days' ? 'days' : 'disk',
    maxDiskUsagePercent: Math.min(99, Math.max(1, finiteNumber(next.maxDiskUsagePercent, current.maxDiskUsagePercent || 80))),
    maxRawRecordingGigabytes: Math.max(1, finiteNumber(next.maxRawRecordingGigabytes, current.maxRawRecordingGigabytes || 250)),
    clipLengthSeconds: Math.max(5, Math.min(3600, finiteNumber(next.clipLengthSeconds, current.clipLengthSeconds || 60))),
    obsRecordingQuality: choice(next.obsRecordingQuality, ['HQ', 'Small', 'Lossless', 'Stream'], current.obsRecordingQuality || 'HQ'),
    obsResolution: choice(next.obsResolution, ['2560x1440', '1920x1080', '1280x720'], current.obsResolution || '1920x1080'),
    obsFps: choice(finiteNumber(next.obsFps, current.obsFps || 60), [30, 60], current.obsFps || 60),
    obsFormat: choice(String(next.obsFormat || ''), ['mkv', 'mp4', 'mov', 'flv'], current.obsFormat || 'mkv'),
    instantReplay: !!next.instantReplay,
    instantReplayLengthSeconds: Math.max(5, Math.min(3600, finiteNumber(next.instantReplayLengthSeconds, current.instantReplayLengthSeconds || 300))),
    microphoneDeviceId: String(next.microphoneDeviceId || 'disabled'),
    microphoneVolumePercent: Math.min(200, Math.max(0, Number(next.microphoneVolumePercent) || 0)),
    microphoneNoiseGateDb: Math.min(-5, Math.max(-60, Number(next.microphoneNoiseGateDb) || -40)),
    microphoneNvidiaNoiseRemoval: next.microphoneNvidiaNoiseRemoval !== false,
    microphoneNoiseSuppression: undefined,
    audioExecutables: Array.isArray(next.audioExecutables) ? next.audioExecutables : [],
    ignoredGameExecutables: Array.isArray(next.ignoredGameExecutables) ? next.ignoredGameExecutables.map(String) : [],
    markerHotkey: String(next.markerHotkey ?? '').trim(),
    gameProfiles,
    desktopWindow: next.desktopWindow !== false,
    nightlyUpdates: !!next.nightlyUpdates,
    telemetryMode: ['diagnostics', 'version', 'off'].includes(next.telemetryMode)
      ? next.telemetryMode
      : (current.telemetryMode || 'pending')
  };
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

module.exports = { normalizeSettingsUpdate, captureRestartRequired };
