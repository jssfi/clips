const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('experimental desktop-window setting makes the hosted UI discoverable', () => {
  const html = source('src/index.html');
  const renderer = source('src/renderer.js');
  assert.match(html, /id="desktop-window"[^>]*name="desktopWindow"/);
  assert.match(html, /Turn this off to use clips\.jss\.fi\/app/);
  assert.match(renderer, /desktopWindow: \$\("desktop-window"\)\.checked/);
});

test('browser build connects to the restricted loopback gateway and retains demo fallback', () => {
  const web = source('clips-worker/src/web.js');
  assert.match(web, /http:\/\/127\.0\.0\.1:\$\{gatewayPort\}\/v1/);
  assert.match(web, /targetAddressSpace: 'local'/);
  assert.match(web, /Connect Clips/);
  assert.match(web, /gatewayConnected \? currentState : demoState/);
});

test('shared player supports browser video without removing native canvas playback', () => {
  const html = source('src/index.html');
  const renderer = source('src/renderer.js');
  assert.match(html, /id="mpv-canvas"/);
  assert.match(html, /id="browser-video"/);
  assert.match(renderer, /classList\.toggle\("browser-playback", !!preview\.mediaUrl\)/);
});
