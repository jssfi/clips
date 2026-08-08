const assert = require('node:assert/strict');
const path = require('node:path');
const { ObsController } = require('../src/obs');

async function main() {
  const root = path.join(__dirname, '..');
  const runtimeRoot = path.join(root, 'vendor');
  const controller = new ObsController();
  await controller.connect({
    executable: path.join(runtimeRoot, 'libobs', 'bin', '64bit', 'clips-capture-host.exe'),
    runtimeRoot,
    configRoot: path.join(root, '.clips-dev', 'capture-controller'),
    settings: {
      obsResolution: '1280x720',
      obsFps: 30,
      obsRecordingQuality: 'Small',
      obsFormat: 'mkv',
      clipLengthSeconds: 5
    }
  });
  const status = await controller.status();
  assert.equal(status.connected, true);
  assert.equal(status.recording, false);
  const microphones = await controller.microphones();
  assert.ok(Array.isArray(microphones));
  for (const microphone of microphones) {
    assert.equal(typeof microphone.id, 'string');
    assert.equal(typeof microphone.name, 'string');
  }
  await controller.disconnect();
  assert.equal(controller.connected, false);
  console.log('Electron capture controller initialized and shut down the private libobs host successfully.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
