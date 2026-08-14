const test = require('node:test');
const assert = require('node:assert/strict');
const { isProbableGameWindow, updateCandidateHistory } = require('../src/game-candidates');

const game = { name: 'ExampleGame.exe', path: 'D:\\Games\\ExampleGame.exe', title: 'Example Game', isFullscreen: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

test('only fullscreen non-system windows can become game candidates', () => {
  assert.equal(isProbableGameWindow(game), true);
  assert.equal(isProbableGameWindow({ ...game, name: 'chrome.exe' }), false);
  assert.equal(isProbableGameWindow({ ...game, isFullscreen: false }), false);
  assert.equal(isProbableGameWindow({ ...game, isFullscreen: undefined }), false);
  assert.equal(isProbableGameWindow({ ...game, bounds: { x: 0, y: 0, width: 800, height: 500 } }), false);
});

test('candidate must remain visible and is suppressed by configured or ignored lists', () => {
  const history = new Map();
  assert.deepEqual(updateCandidateHistory(history, [game], [], [], 1000), []);
  assert.deepEqual(updateCandidateHistory(history, [game], [], [], 16001), [game]);
  assert.deepEqual(updateCandidateHistory(history, [game], ['examplegame.exe'], [], 17000), []);
  assert.deepEqual(updateCandidateHistory(history, [game], [], ['EXAMPLEGAME.EXE'], 17000), []);
});
