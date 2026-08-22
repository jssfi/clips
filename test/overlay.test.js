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

test('the overlay window has transparent margin for the landing shockwave', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const overlayWindow = source.match(/const overlayWindow = new BrowserWindow\(\{([\s\S]*?)webPreferences:/);

  assert.ok(overlayWindow, 'overlay window configuration should exist');
  assert.match(overlayWindow[1], /width:\s*(?:5[6-9]\d|[6-9]\d{2,})\s*,/);
});

test('the overlay landing effect is canvas-based, directional, and motion-aware', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'overlay.html'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'src', 'overlay.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'overlay.css'), 'utf8');

  assert.match(html, /<canvas id="impact"/);
  assert.match(script, /event\.propertyName === 'transform'/);
  assert.match(script, /if \(y < rect\.top\) continue;/);
  assert.match(script, /kind === 'recording-stopped'/);
  assert.match(script, /reverse \? 1 - eased : eased/);
  assert.match(script, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.impact\s*\{[\s\S]*pointer-events:\s*none;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.impact\s*\{\s*display:\s*none;/);
});
