const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('native player rejects unbounded frame allocations', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'mpv-host.cpp'), 'utf8');
  assert.match(source, /MAX_FRAME_DIMENSION\s*=\s*8192/);
  assert.match(source, /validFrameSize\(width, height\)/);
  assert.match(source, /numeric_limits<size_t>::max\)\(\) \/ stride/);
  assert.match(source, /Invalid video frame dimensions/);
});
