const assert = require('node:assert/strict');
const test = require('node:test');
const { ObsController } = require('../src/obs');

test('stopSession allows the capture engine time to finalize its outputs', async () => {
  const controller = new ObsController();
  controller.connected = true;

  let request;
  controller.request = async (...args) => {
    request = args;
  };

  await controller.stopSession();

  assert.deepEqual(request, ['stop', {}, 60000]);
});

test('startSession sends the selected microphone and desktop audio to the capture engine', async () => {
  const controller = new ObsController();
  controller.applications = [];

  let request;
  controller.request = async (...args) => {
    request = args;
  };

  await controller.startSession('C:\\Clips', [], 'microphone-id', 75, -35, true);

  assert.equal(request[0], 'start');
  assert.equal(request[1].microphoneDeviceId, 'microphone-id');
  assert.equal(request[1].microphoneVolumePercent, 75);
  assert.equal(request[1].microphoneNoiseGateDb, -35);
  assert.equal(request[1].microphoneNvidiaNoiseRemoval, true);
  assert.equal(request[1].applications[0].captureDisplay, true);
  assert.equal(request[1].applications[0].captureVideo, true);
  assert.equal(request[1].applications[0].captureAudio, true);
});

test('microphone volume is sent to the running capture engine', async () => {
  const controller = new ObsController();
  controller.connected = true;
  let request;
  controller.request = async (...args) => { request = args; };
  await controller.setMicrophoneVolume(125);
  assert.deepEqual(request, ['microphoneVolume', { microphoneVolumePercent: 125 }]);
});
