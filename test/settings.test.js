const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSettingsUpdate, captureRestartRequired } = require('../src/settings');

const base = {
  recordingsFolder: 'C:\\Clips',
  retentionDays: 5,
  storageCleanupMode: 'disk',
  maxDiskUsagePercent: 80,
  maxRawRecordingGigabytes: 250,
  clipLengthSeconds: 60,
  instantReplay: false,
  instantReplayLengthSeconds: 300,
  microphoneDeviceId: 'disabled',
  microphoneVolumePercent: 100,
  microphoneNoiseGateDb: -40,
  microphoneNvidiaNoiseRemoval: true,
  audioExecutables: ['Discord.exe'],
  desktopWindow: true,
  nightlyUpdates: true,
  telemetryMode: 'version'
};

test('storage and microphone settings are normalized for persistence', () => {
  const settings = normalizeSettingsUpdate(base, {
    ...base,
    recordingsFolder: 'F:\\Saved Clips',
    microphoneDeviceId: 'microphone-id'
  });
  assert.equal(settings.recordingsFolder, 'F:\\Saved Clips');
  assert.equal(settings.microphoneDeviceId, 'microphone-id');
  assert.equal(settings.microphoneVolumePercent, 100);
  assert.equal(settings.microphoneNoiseGateDb, -40);
  assert.equal(settings.microphoneNvidiaNoiseRemoval, true);
});

test('desktop window remains the default unless explicitly disabled', () => {
  assert.equal(normalizeSettingsUpdate(base, { ...base }).desktopWindow, true);
  assert.equal(normalizeSettingsUpdate(base, { ...base, desktopWindow: false }).desktopWindow, false);
});

test('instant replay is opt-in', () => {
  assert.equal(normalizeSettingsUpdate(base, { ...base }).instantReplay, false);
  assert.equal(normalizeSettingsUpdate(base, { ...base, instantReplay: true }).instantReplay, true);
  assert.equal(normalizeSettingsUpdate(base, { ...base }).instantReplayLengthSeconds, 300);
  assert.equal(normalizeSettingsUpdate(base, { ...base, instantReplayLengthSeconds: 120 }).instantReplayLengthSeconds, 120);
});

test('marker shortcut can be disabled by clearing it', () => {
  const settings = normalizeSettingsUpdate({ ...base, markerHotkey: 'CommandOrControl+Shift+F9' }, { ...base, markerHotkey: '' });
  assert.equal(settings.markerHotkey, '');
});

test('telemetry preference only accepts explicit consent choices', () => {
  assert.equal(normalizeSettingsUpdate(base, { ...base, telemetryMode: 'diagnostics' }).telemetryMode, 'diagnostics');
  assert.equal(normalizeSettingsUpdate(base, { ...base, telemetryMode: 'unexpected' }).telemetryMode, 'version');
});

test('live capture restarts when folder or microphone changes', () => {
  assert.equal(captureRestartRequired(base, { ...base, recordingsFolder: 'F:\\Clips' }), true);
  assert.equal(captureRestartRequired(base, { ...base, microphoneDeviceId: 'microphone-id' }), true);
  assert.equal(captureRestartRequired(base, { ...base, retentionDays: 30 }), false);
});
