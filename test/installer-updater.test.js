const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createInstallerUpdater } = require('../src/installer-updater');

test('installer updater downloads through NSIS and installs on restart', async () => {
  const updater = new EventEmitter();
  updater.setFeedURL = value => { updater.feed = value; };
  updater.checkForUpdates = async () => { updater.checked = true; };
  updater.quitAndInstall = (...args) => { updater.installArgs = args; };
  const states = [];
  const client = createInstallerUpdater({ feedUrl: 'https://updates.example/nightly', onState: state => states.push(state), updater });

  assert.deepEqual(updater.feed, { provider: 'generic', url: 'https://updates.example/nightly' });
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  await client.check();
  updater.emit('download-progress', { percent: 42.4 });
  updater.emit('update-downloaded', { version: '0.5.0-nightly.15.deadbeef' });
  await client.restart();

  assert.equal(updater.checked, true);
  assert.deepEqual(states.at(-1), { status: 'ready', version: '0.5.0-nightly.15.deadbeef', percent: 100, message: 'Restart to update' });
  assert.deepEqual(updater.installArgs, [true, true]);
  client.dispose();
  assert.equal(updater.listenerCount('update-downloaded'), 0);
});
