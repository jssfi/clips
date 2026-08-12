const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('the overlay window has room for multi-line warning details', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const overlayWindow = source.match(/const overlayWindow = new BrowserWindow\(\{([\s\S]*?)webPreferences:/);

  assert.ok(overlayWindow, 'overlay window configuration should exist');
  assert.match(overlayWindow[1], /height:\s*(?:1[8-9]\d|[2-9]\d{2,})\s*,/);
});
