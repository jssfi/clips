const path = require('path');

function normalizeSettingsUpdate(current, next) {
  const requestedFolder = String(next.recordingsFolder || '').trim();
  if (!requestedFolder) throw new Error('Choose a storage folder.');
  const gameProfiles = Object.fromEntries(Object.entries(next.gameProfiles || {}).map(([executable, profile]) => [String(executable).toLowerCase(), {
    quality: ['HQ', 'Small', 'Lossless', 'Stream'].includes(profile?.quality) ? profile.quality : '',
    resolution: ['2560x1440', '1920x1080', '1280x720'].includes(profile?.resolution) ? profile.resolution : '',
    fps: [30, 60].includes(Number(profile?.fps)) ? Number(profile.fps) : 0,
    clipLengthSeconds: profile?.clipLengthSeconds ? Math.max(5, Math.min(3600, Number(profile.clipLengthSeconds))) : 0,
    microphoneDeviceId: String(profile?.microphoneDeviceId || ''),
    audioExecutables: Array.isArray(profile?.audioExecutables) ? profile.audioExecutables.map(String) : undefined
  }]));
  return {
    ...current,
    ...next,
    recordingsFolder: path.resolve(requestedFolder),
    retentionDays: Math.max(1, Number(next.retentionDays) || 1),
    storageCleanupMode: next.storageCleanupMode === 'days' ? 'days' : 'disk',
    maxDiskUsagePercent: Math.min(99, Math.max(1, Number(next.maxDiskUsagePercent) || 80)),
    maxRawRecordingGigabytes: Math.max(1, Number(next.maxRawRecordingGigabytes) || 250),
    clipLengthSeconds: Math.max(5, Number(next.clipLengthSeconds) || 60),
    microphoneDeviceId: String(next.microphoneDeviceId || 'disabled'),
    microphoneVolumePercent: Math.min(200, Math.max(0, Number(next.microphoneVolumePercent) || 0)),
    microphoneNoiseGateDb: Math.min(-5, Math.max(-60, Number(next.microphoneNoiseGateDb) || -40)),
    microphoneNvidiaNoiseRemoval: next.microphoneNvidiaNoiseRemoval !== false,
    microphoneNoiseSuppression: undefined,
    audioExecutables: Array.isArray(next.audioExecutables) ? next.audioExecutables : [],
    markerHotkey: String(next.markerHotkey ?? '').trim(),
    gameProfiles,
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
