const test = require('node:test');
const assert = require('node:assert/strict');
const { trayIconPng } = require('../src/tray-icon');

test('tray icon creates distinct valid PNGs for idle and recording states', () => {
  const idle = trayIconPng(false);
  const recording = trayIconPng(true);

  assert.deepEqual([...idle.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(idle.readUInt32BE(16), 32);
  assert.equal(idle.readUInt32BE(20), 32);
  assert.notDeepEqual(idle, recording);
});

test('app icon renderer supports larger Windows icon sizes', () => {
  const icon = trayIconPng(false, 256);

  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
});
