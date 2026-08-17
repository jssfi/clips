const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { mediaContentType } = require('../src/media-server');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const packageJson = require('../package.json');

test('media serving and tray ownership are outside the Electron lifecycle module', () => {
  assert.doesNotMatch(main, /http\.createServer|new Tray|Menu\.buildFromTemplate|mediaTokens/);
  assert.match(main, /createRecordingMediaServer/);
  assert.match(main, /createTrayController/);
  assert.equal(mediaContentType('recording.mkv'), 'video/x-matroska');
  assert.equal(mediaContentType('recording.mp4'), 'video/mp4');
});

test('standard checks use the isolated Worker checker', () => {
  assert.match(packageJson.scripts.check, /node scripts\/check-workers\.mjs/);
  assert.doesNotMatch(packageJson.scripts.check, /npm --prefix .* run check/);
  const checker = fs.readFileSync(path.join(root, 'scripts', 'check-workers.mjs'), 'utf8');
  assert.match(checker, /mkdtemp/);
  assert.match(checker, /CLIPS_HERMETIC_CHECK: '1'/);
});
