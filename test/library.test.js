const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LibraryMetadata, storageInsights, concatManifest } = require('../src/library');

test('library metadata normalizes titles, tags, and timeline markers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-library-'));
  const file = path.join(root, '2026-08-12', 'Recording.mkv');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'video');
  const library = new LibraryMetadata(path.join(root, 'library.json'), root);
  const item = library.update(file, { title: '  Victory  ', tags: ['win', 'win', '  ranked '], markers: [{ id: 'b', time: 12 }, { id: 'a', time: 3 }] });
  assert.equal(item.title, 'Victory'); assert.deepEqual(item.tags, ['win', 'ranked']); assert.deepEqual(item.markers.map(marker => marker.id), ['a', 'b']);
});

test('storage insights group bytes by game', () => {
  const result = storageInsights('Z:\\missing', [{ bytes: 20, game: 'Game A' }, { bytes: 10, game: 'Game A' }, { bytes: 5 }]);
  assert.equal(result.totalBytes, 35); assert.deepEqual(result.byGame, [{ game: 'Game A', bytes: 30 }, { game: 'Uncategorized', bytes: 5 }]);
});

test('concat manifest preserves clip order', () => {
  assert.equal(concatManifest(['C:\\one.mkv', 'C:\\two.mkv']), "file 'C:\\one.mkv'\nfile 'C:\\two.mkv'\n");
});
