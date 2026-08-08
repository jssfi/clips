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
