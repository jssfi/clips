const test = require('node:test');
const assert = require('node:assert/strict');
const { displayVersion } = require('../src/version');

test('stable releases omit the zero patch in the UI', () => {
  assert.equal(displayVersion('0.3.0'), '0.3');
});

test('nightly releases display their source commit hash', () => {
  assert.equal(displayVersion('0.3.1-nightly.42.a1b2c3d4'), '0.3-a1b2c3d4');
});

test('next-minor nightlies display their development sequence', () => {
  assert.equal(displayVersion('0.5.0-nightly.1.a1b2c3d4'), '0.5-nightly.1');
  assert.equal(displayVersion('0.5.0-nightly.n000019.a1b2c3d4'), '0.5-nightly.19');
});
