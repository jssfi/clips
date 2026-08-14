const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('ordinary release artifacts build concurrently from shared metadata', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'build-release.mjs'), 'utf8');
  assert.equal((script.match(/scripts\/write-build-info\.js/g) || []).length, 1);
  assert.match(script, /Promise\.all\(\[updateInstaller, stagedApplication, sourceBundle\]\)/);
  for (const file of ['electron-builder.update.json', 'electron-builder.staged.json']) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).npmRebuild, false);
  }
  const updateConfig = JSON.parse(fs.readFileSync(path.join(root, 'electron-builder.update.json'), 'utf8'));
  assert.notEqual(updateConfig.nsis.differentialPackage, false);
  assert.match(fs.readFileSync(path.join(root, 'scripts', 'build-staged-update.ps1'), 'utf8'), /-mx=1/);
});

test('GitHub release assets upload concurrently with large read buffers', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'publish-github-release.mjs'), 'utf8');
  assert.match(script, /Promise\.all\(artifacts\.map\(uploadArtifact\)\)/);
  assert.match(script, /highWaterMark: 4 \* 1024 \* 1024/);
});
