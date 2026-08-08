const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProcessList } = require('../src/process-list');

test('process list parsing normalizes a single PowerShell object', () => {
  assert.deepEqual(parseProcessList('{"name":"game.exe","path":null,"title":"Game","windowClass":"GameWnd","bounds":null}'), [{
    name: 'game.exe', path: '', title: 'Game', windowClass: 'GameWnd', bounds: null
  }]);
});

test('process list parsing rejects incomplete PowerShell JSON', () => {
  assert.throws(() => parseProcessList('[{"name":"game.exe"}'), SyntaxError);
});
