const test = require('node:test');
const assert = require('node:assert/strict');
const { pruneLogText } = require('../src/logger');

test('log pruning keeps only the recent hour', () => {
  const text = [
    '[2026-07-29T10:00:00.000Z] [INFO] old',
    '[2026-07-29T11:15:00.000Z] [INFO] recent'
  ].join('\n');
  assert.equal(
    pruneLogText(text, Date.parse('2026-07-29T11:00:00.000Z'), 1024),
    '[2026-07-29T11:15:00.000Z] [INFO] recent\n'
  );
});

test('log pruning respects the file-size cap', () => {
  const text = [
    '[2026-07-29T11:15:00.000Z] [INFO] first',
    '[2026-07-29T11:16:00.000Z] [INFO] second'
  ].join('\n');
  const result = pruneLogText(text, Date.parse('2026-07-29T11:00:00.000Z'), 50);
  assert.doesNotMatch(result, /first/);
  assert.match(result, /second/);
});
