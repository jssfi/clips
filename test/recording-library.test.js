const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecordingLibrary, isRawRecordingName } = require('../src/recording-library');

function fixture(overrides = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-recordings-'));
  const recordingsFolder = path.join(base, 'recordings');
  fs.mkdirSync(recordingsFolder);
  const settings = { recordingsFolder, storageCleanupMode: 'age', retentionDays: 2, ...overrides };
  const metadata = new Map();
  const library = createRecordingLibrary({
    getSettings: () => settings,
    getMetadata: () => ({ get: file => metadata.get(file) || {} }),
    favoritesPath: () => path.join(base, 'favorites.json'),
    today: () => '2026-08-17'
  });
  library.loadFavorites();
  return { base, recordingsFolder, metadata, library };
}

function recording(root, day, name, contents = 'video') {
  const file = path.join(root, day, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}

test('recording library lists and enriches recent and archived recordings', () => {
  const { recordingsFolder, metadata, library } = fixture();
  const recent = recording(recordingsFolder, '2026-08-17', 'Replay 1.mkv');
  recording(recordingsFolder, '2026-08-16', 'Recording.mp4', 'longer video');
  metadata.set(recent, { title: 'Last fight', tags: ['ranked'], game: 'Arena' });
  library.setFavorite(recent, true);

  assert.deepEqual(library.recentRecordings().map(item => ({ name: item.name, title: item.title, kind: item.kind, favorite: item.favorite })), [
    { name: 'Replay 1.mkv', title: 'Last fight', kind: 'replay', favorite: true }
  ]);
  assert.deepEqual(library.archivedRecordings().map(item => ({ name: item.name, day: item.day, bytes: item.bytes })), [
    { name: 'Recording.mp4', day: '2026-08-16', bytes: 12 }
  ]);
});

test('age cleanup deletes only expired raw footage and preserves favorites and exports', () => {
  const { recordingsFolder, library } = fixture();
  const expired = recording(recordingsFolder, '2026-08-14', 'Recording.mkv');
  const favorite = recording(recordingsFolder, '2026-08-14', 'Favorite.mkv');
  const replay = recording(recordingsFolder, '2026-08-14', 'Replay 1.mkv');
  const trimmed = recording(recordingsFolder, '2026-08-14', 'Recording-trimmed.mkv');
  const current = recording(recordingsFolder, '2026-08-16', 'Recording.mkv');
  library.setFavorite(favorite, true);

  library.cleanupStorage(folder => fs.mkdirSync(folder, { recursive: true }));

  assert.equal(fs.existsSync(expired), false);
  for (const preserved of [favorite, replay, trimmed, current]) assert.equal(fs.existsSync(preserved), true);
});

test('recording path validation rejects missing and outside files', () => {
  const { base, recordingsFolder, library } = fixture();
  const inside = recording(recordingsFolder, '2026-08-17', 'Recording.mkv');
  const outside = path.join(base, 'outside.mkv'); fs.writeFileSync(outside, 'video');
  assert.equal(library.validatePath(inside), inside);
  assert.throws(() => library.validatePath(outside), /no longer exists/);
  assert.throws(() => library.validatePath(path.join(recordingsFolder, 'missing.mkv')), /no longer exists/);
});

test('raw recording classification excludes replays and derived trims', () => {
  assert.equal(isRawRecordingName('Recording.mkv'), true);
  assert.equal(isRawRecordingName('Replay-123.mkv'), false);
  assert.equal(isRawRecordingName('Recording-trimmed-2.mp4'), false);
  assert.equal(isRawRecordingName('notes.txt'), false);
});
