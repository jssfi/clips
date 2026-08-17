const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageConfigurations = [
  'electron-builder.bootstrap.json',
  'electron-builder.update.json',
  'electron-builder.staged.json'
];
const browserAssets = [
  'clips-worker/src/web.js',
  'clips-worker/src/web.css'
];

test('every application package includes the browser UI assets', () => {
  for (const asset of browserAssets) {
    assert.equal(fs.existsSync(path.join(root, asset)), true, `${asset} must exist`);
  }

  for (const file of packageConfigurations) {
    const config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    for (const asset of browserAssets) {
      assert.equal(config.files.includes(asset), true, `${file} must package ${asset}`);
    }
  }
});

test('staged and installer updates carry the same player runtime components', () => {
  for (const file of ['electron-builder.staged.json', 'electron-builder.update.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const sources = new Set(config.extraResources.map(resource => resource.from.replace(/\\/g, '/')));
    for (const expected of ['vendor/libmpv/mpv-host.exe', 'vendor/libmpv/libmpv-2.dll', 'vendor/mpv/mpv.exe']) {
      assert.ok(sources.has(expected), `${file} must package ${expected}`);
    }
  }
});
