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
