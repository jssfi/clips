const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('experimental desktop-window setting makes the browser UI discoverable', () => {
  const html = source('src/index.html');
  const renderer = source('src/renderer.js');
  assert.match(html, /id="desktop-window"[^>]*name="desktopWindow"/);
  assert.match(html, /Turn this off to use Clips in your browser/);
  assert.match(renderer, /desktopWindow: \$\("desktop-window"\)\.checked/);
});

test('browser build connects to the restricted loopback gateway and retains demo fallback', () => {
  const web = source('clips-worker/src/web.js');
  assert.match(web, /http:\/\/127\.0\.0\.1:\$\{gatewayPort\}\/v1/);
  assert.match(web, /targetAddressSpace: 'local'/);
  assert.match(web, /Connect Clips/);
  assert.match(web, /location\.assign\(`http:\/\/127\.0\.0\.1:\$\{gatewayPort\}\/app\/`\)/);
  assert.match(web, /const localUi = location\.hostname === '127\.0\.0\.1'/);
  assert.match(web, /if \(!localUi\) \{/);
  assert.match(web, /gatewayConnected \? currentState : demoState/);
});

test('shared player supports browser video without removing native canvas playback', () => {
  const html = source('src/index.html');
  const renderer = source('src/renderer.js');
  assert.match(html, /id="mpv-canvas"/);
  assert.match(html, /id="browser-video"/);
  assert.match(renderer, /classList\.toggle\("browser-playback", !!preview\.mediaUrl\)/);
});

test('browser media disconnects handle normal broken pipes', () => {
  const main = source('src/main.js');
  assert.match(main, /pipeline\(ffmpeg\.stdout, response/);
  assert.match(main, /'EPIPE', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'/);
  assert.match(main, /request\.on\('aborted', stopStream\)/);
});
