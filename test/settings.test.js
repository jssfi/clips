const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSettingsFile, normalizeStoredSettings, normalizeSettingsUpdate, captureRestartRequired } = require('../src/settings');

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
  assert.equal(normalizeSettingsUpdate({ ...base, clipHotkey: 'Ctrl+F10' }, { ...base, clipHotkey: 'do something dangerous' }).clipHotkey, 'Ctrl+F10');
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

test('malformed capture settings fall back to valid persisted values', () => {
  const current = { ...base, obsRecordingQuality: 'HQ', obsResolution: '1920x1080', obsFps: 60, obsFormat: 'mkv' };
  const settings = normalizeSettingsUpdate(current, {
    ...current, obsRecordingQuality: 'invalid', obsResolution: 'huge', obsFps: 'fast', obsFormat: 'exe', clipLengthSeconds: 'never',
    gameProfiles: { 'GAME.EXE': { quality: 'bad', resolution: 'bad', fps: 'bad', clipLengthSeconds: 'forever' } }
  });
  assert.deepEqual([settings.obsRecordingQuality, settings.obsResolution, settings.obsFps, settings.obsFormat, settings.clipLengthSeconds], ['HQ', '1920x1080', 60, 'mkv', 60]);
  assert.equal(settings.gameProfiles['game.exe'].clipLengthSeconds, 5);
  assert.equal(Number.isFinite(settings.gameProfiles['game.exe'].clipLengthSeconds), true);
});

test('stored settings are fully normalized and unknown fields are discarded', () => {
  const settings = normalizeStoredSettings({
    ...base,
    gameExecutables: [], ignoredGameExecutables: [], autoRecord: true, startWithWindows: true,
    clipHotkey: 'Ctrl+F10', markerHotkey: '', gameProfiles: {}, pollSeconds: 5, stopDelaySeconds: 20,
    obsRecordingQuality: 'HQ', obsResolution: '1920x1080', obsFps: 60, obsFormat: 'mkv', trimBitrate: 'original'
  }, {
    ...base,
    gameExecutables: 'not-an-array', ignoredGameExecutables: [null, ' Game.exe ', 'Game.exe'],
    audioExecutables: [12, ' Discord.exe ', ''], autoRecord: 'false', pollSeconds: -20,
    stopDelaySeconds: Infinity, clipHotkey: 42, unknownSecret: 'discard me',
    gameProfiles: { ' GAME.EXE ': { fps: 900, audioExecutables: 'bad' } }
  });
  assert.deepEqual(settings.gameExecutables, []);
  assert.deepEqual(settings.ignoredGameExecutables, ['Game.exe']);
  assert.deepEqual(settings.audioExecutables, ['Discord.exe']);
  assert.equal(settings.autoRecord, true);
  assert.equal(settings.pollSeconds, 2);
  assert.equal(settings.stopDelaySeconds, 20);
  assert.equal(settings.clipHotkey, 'Ctrl+F10');
  assert.equal(settings.unknownSecret, undefined);
  assert.equal(settings.gameProfiles['game.exe'].audioExecutables, undefined);
  assert.equal(settings.gameProfiles['game.exe'].fps, 0);
});

test('legacy stop delay migrates to clip length before validation', () => {
  const settings = normalizeStoredSettings({ ...base, clipLengthSeconds: 60 }, { ...base, clipLengthSeconds: null, stopDelaySeconds: 90 });
  assert.equal(settings.clipLengthSeconds, 90);
});

test('malformed settings are quarantined before defaults can be persisted', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-settings-'));
  try {
    const currentPath = path.join(directory, 'settings.json');
    fs.writeFileSync(currentPath, '{not json');
    const loaded = loadSettingsFile({
      currentPath,
      legacyPath: path.join(directory, 'legacy.json'),
      defaults: base,
      now: () => new Date('2026-08-17T12:00:00.000Z')
    });
    assert.equal(loaded.persistenceBlocked, false);
    assert.equal(fs.existsSync(currentPath), false);
    assert.equal(fs.readFileSync(loaded.backupPath, 'utf8'), '{not json');
    assert.match(loaded.warning, /original file was preserved/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('settings persistence is blocked when an unreadable file cannot be quarantined', () => {
  const fakeFs = {
    existsSync: candidate => candidate === 'current.json',
    readFileSync: () => { throw new Error('access denied'); },
    renameSync: () => { throw new Error('still denied'); }
  };
  const loaded = loadSettingsFile({ currentPath: 'current.json', legacyPath: 'legacy.json', defaults: base, fsModule: fakeFs });
  assert.equal(loaded.persistenceBlocked, true);
  assert.match(loaded.warning, /left untouched/);
  assert.equal(loaded.backupError.message, 'still denied');
});
