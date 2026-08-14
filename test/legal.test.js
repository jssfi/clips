const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('native hosts carry GPL identifiers', () => {
  for (const file of ['capture-host.cpp', 'mpv-host.cpp']) {
    const source = fs.readFileSync(path.join(root, 'native', file), 'utf8');
    assert.match(source, /SPDX-License-Identifier: GPL-2\.0-or-later/);
  }
});

test('every package configuration includes legal notices', () => {
  for (const file of ['electron-builder.bootstrap.json', 'electron-builder.update.json', 'electron-builder.staged.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    assert.equal(config.extraResources.some(resource => resource.from === 'legal' && resource.to === 'legal'), true);
  }
});

test('third-party notice records pinned distributed builds', () => {
  const notice = fs.readFileSync(path.join(root, 'legal', 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const value of ['31.1.2', 'dd5d17d32', 'f944afd04', '--enable-gpl', '--enable-version3']) assert.match(notice, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('legal staging includes first-party and exact upstream notices', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'stage-legal.ps1'), 'utf8');
  for (const value of ['Clips-MIT.txt', '7-Zip-21.07.txt', '7zip-bin-MIT.txt', 'OBS-Studio-COPYING.txt', 'MPV-Copyright.txt', 'MPV-GPL.txt']) {
    assert.match(script, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('release publishing archives corresponding source bundles on GitHub', () => {
  const publisher = fs.readFileSync(path.join(root, 'scripts', 'publish-github-release.mjs'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'clips-worker', 'src', 'updates.ts'), 'utf8');
  assert.match(publisher, /jss-clips-source-/);
  assert.match(publisher, /releases\/tags/);
  assert.match(worker, /jss-clips-source-/);
  assert.match(worker, /githubReleaseUrl/);
});
