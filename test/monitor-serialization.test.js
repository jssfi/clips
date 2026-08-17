const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('monitor scheduling coalesces requests while a monitor is active', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(source, /if \(monitorPromise\) \{\s*monitorRerunRequested = true;\s*return monitorPromise;/);
  assert.match(source, /monitorPromise = monitor\(\)\.finally/);
  assert.match(source, /monitorTimer = setTimeout\(scheduleMonitor, monitorDelayMs\(\)\)/);
  assert.doesNotMatch(source, /monitorTimer = setTimeout\(monitor, monitorDelayMs\(\)\)/);
});
