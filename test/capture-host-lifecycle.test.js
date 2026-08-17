const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'native', 'capture-host.cpp'), 'utf8');

test('capture host rolls back failed initialization', () => {
  assert.match(source, /void initialize\(obs_data_t \*request\)[\s\S]*?catch \(\.\.\.\) \{\s*shutdown\(\);\s*throw;/);
});

test('capture host shutdown handles partial initialization and restores process state', () => {
  const shutdownStart = source.indexOf('\tvoid shutdown()');
  const shutdownEnd = source.indexOf('\nprivate:', shutdownStart);
  const shutdown = source.slice(shutdownStart, shutdownEnd);
  assert.doesNotMatch(shutdown, /if \(!obs_started\(\)\)\s*return/);
  assert.match(shutdown, /if \(scene_\)/);
  assert.match(shutdown, /RemoveDllDirectory\(dll_cookie_\)/);
  assert.match(shutdown, /SetCurrentDirectoryW\(previous_current_directory_\.c_str\(\)\)/);
  assert.match(shutdown, /initialized_ = false/);
});
