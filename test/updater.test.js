const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  compareVersions,
  cleanupOldVersionDirectories,
  isPreparationDirectory,
  isVersionDirectory,
  validateMetadata
} = require('../src/updater');

test('old app versions are pruned while active and rollback versions are retained', async t => {
  const versions = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-versions-'));
  t.after(() => fs.rmSync(versions, { recursive: true, force: true }));
  const names = ['0.1.50.app-old', '0.1.51.app-active', '0.1.52.app-new'];
  for (const [index, name] of names.entries()) {
    const directory = path.join(versions, name);
    fs.mkdirSync(directory);
    const timestamp = new Date(2026, 0, index + 1);
    fs.utimesSync(directory, timestamp, timestamp);
  }

  await cleanupOldVersionDirectories(versions, {
    protectedDirectories: ['0.1.51.app-active'],
    retain: 2
  });

  assert.deepEqual(fs.readdirSync(versions).sort(), [
    '0.1.51.app-active',
    '0.1.52.app-new'
  ]);
});

test('compareVersions orders patch releases', () => {
  assert.equal(compareVersions('0.1.12', '0.1.11'), 1);
  assert.equal(compareVersions('0.1.11', '0.1.12'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('isPreparationDirectory recognizes fixed and unique updater staging directories', () => {
  assert.equal(isPreparationDirectory('0.1.13.preparing'), true);
  assert.equal(isPreparationDirectory('0.1.14.preparing-1234-5678-abcd'), true);
  assert.equal(isPreparationDirectory('0.1.14'), false);
  assert.equal(isPreparationDirectory('../0.1.14.preparing'), false);
});

test('isVersionDirectory accepts only safe canonical and immutable version directories', () => {
  assert.equal(isVersionDirectory('0.1.17', '0.1.17'), true);
  assert.equal(isVersionDirectory('0.1.17.app-1234-5678-abcd', '0.1.17'), true);
  assert.equal(isVersionDirectory('0.1.16.app-1234', '0.1.17'), false);
  assert.equal(isVersionDirectory('0.1.17.preparing', '0.1.17'), false);
  assert.equal(isVersionDirectory('../0.1.17.app-1234', '0.1.17'), false);
});

test('validateMetadata accepts a matching immutable application package', () => {
  assert.deepEqual(validateMetadata({
    version: '0.1.12',
    url: 'jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123
  }), {
    version: '0.1.12',
    url: 'jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123
  });
});

test('validateMetadata rejects traversal and mismatched versions', () => {
  assert.throws(() => validateMetadata({
    version: '0.1.12',
    url: '../jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123
  }));
  assert.throws(() => validateMetadata({
    version: '0.1.12',
    url: 'jss-clips-app-0.1.13-x64.zip',
    sha512: 'checksum',
    size: 123
  }));
});
