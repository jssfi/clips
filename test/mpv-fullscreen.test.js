const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT,
  mpvFullscreenArgs
} = require('../src/mpv-fullscreen');

test('fullscreen MPV quits after it leaves fullscreen', () => {
  assert.match(MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT, /observe_property\("fullscreen"/);
  assert.match(MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT, /entered_fullscreen/);
  assert.match(MPV_QUIT_ON_FULLSCREEN_EXIT_SCRIPT, /mp\.command\("quit"\)/);
});

test('fullscreen MPV loads the exit watcher script', () => {
  assert.deepEqual(
    mpvFullscreenArgs('C:\\Clips\\exit.lua', 'C:\\Videos\\clip.mkv'),
    [
      '--fullscreen',
      '--force-window=yes',
      '--osc=yes',
      '--hwdec=auto-safe',
      '--script=C:\\Clips\\exit.lua',
      'C:\\Videos\\clip.mkv'
    ]
  );
});
