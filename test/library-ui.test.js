const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

test('library organization controls live in Library, not Recent', () => {
  const recent = html.slice(html.indexOf('<section id="recent"'), html.indexOf('<section id="library"'));
  const library = html.slice(html.indexOf('<section id="library"'), html.indexOf('<section id="settings"'));
  assert.doesNotMatch(recent, /id="library-search"|id="library-sort"/);
  assert.match(library, /id="library-search"/);
  assert.match(library, /id="library-sort"/);
});

test('marker is shortcut-only and can be disabled', () => {
  const titlebar = html.slice(html.indexOf('<header class="titlebar">'), html.indexOf('</header>'));
  assert.doesNotMatch(titlebar, /id="marker"/);
  assert.match(html, /id="marker-hotkey"[^>]*placeholder="Disabled"/);
});

test('library sort menu defines readable native option colors', () => {
  assert.match(css, /\.library-tools select option\s*\{[^}]*background:\s*#18181b;[^}]*color:\s*#f4f4f5;/);
});

test('update check stays disabled and explains itself when an update is ready', () => {
  assert.match(renderer, /\["checking", "downloading", "preparing", "ready"\]\.includes\(s\.update\?\.status\)/);
  assert.match(renderer, /ready: "Update ready"/);
});
