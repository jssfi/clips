const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const html = source('index.html');
const css = source('styles.css');
const renderer = source('renderer.js');

test('settings navigation is labeled and ordered around common tasks', () => {
  const navigation = html.slice(html.indexOf('id="settings-navigation"'), html.indexOf('<footer class="sidebar-footer">'));
  const groups = [...navigation.matchAll(/data-settings-group="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(groups, ['recording', 'clips', 'video', 'audio', 'storage', 'advanced', 'about']);
  assert.match(css, /body\.settings-open \.settings-nav-item span[\s\S]*?display:\s*inline/);
});

test('common controls are visible while contextual controls use disclosures', () => {
  assert.match(html, /id="settings-recording"[\s\S]*?id="auto"[\s\S]*?id="scan"/);
  assert.match(html, /<details id="ignored-games"/);
  assert.match(html, /<details[^>]*>[\s\S]*?Advanced video settings/);
  assert.match(html, /<details id="microphone-processing"/);
  assert.match(html, /<details id="troubleshooting"/);
  assert.match(renderer, /instant-replay-length-row/);
  assert.match(renderer, /microphone-test-row/);
});

test('trim quality lives only in the editor and per-game controls are labeled', () => {
  assert.doesNotMatch(html, /id="settings-integrations"|id="trim-bitrate"/);
  assert.match(html, /id="editor-trim-bitrate"/);
  assert.match(renderer, /aria-label="\$\{escapeHtml\(game\)\} quality"/);
  assert.match(renderer, /aria-label="\$\{escapeHtml\(game\)\} clip length in seconds"/);
});

