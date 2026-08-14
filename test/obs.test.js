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

test('stopRecording leaves replay-buffer lifecycle to the capture engine', async () => {
  const controller = new ObsController();
  controller.connected = true;
  let request;
  controller.request = async (...args) => { request = args; };
  await controller.stopRecording();
  assert.deepEqual(request, ['stopRecording', {}, 60000]);
});

test('microphone volume is sent to the running capture engine', async () => {
  const controller = new ObsController();
  controller.connected = true;
  let request;
  controller.request = async (...args) => { request = args; };
  await controller.setMicrophoneVolume(125);
  assert.deepEqual(request, ['microphoneVolume', { microphoneVolumePercent: 125 }]);
});

test('capture status retains frame-drop health counters', async () => {
  const controller = new ObsController();
  let status;
  controller.pending.set(7, {
    resolve: response => { status = response; },
    reject: assert.fail,
    timeout: setTimeout(() => {}, 1000)
  });

  controller.handleStdout(`${JSON.stringify({
    id: 7, ok: true, connected: true, recording: true, replayBuffer: true,
    durationMs: 5000, renderedFrames: 300, laggedFrames: 4, outputFrames: 296, droppedFrames: 2
  })}\n`);

  assert.equal(status.ok, true);
  assert.deepEqual(controller.lastStatus, {
    connected: true, recording: true, replayBuffer: true, durationMs: 5000,
    renderedFrames: 300, laggedFrames: 4, outputFrames: 296, droppedFrames: 2
  });
});

test('high-frequency microphone meter polling stays out of the log', () => {
  const events = [];
  const controller = new ObsController(null, { info: (...args) => events.push(args) });
  controller.child = { stdin: { writable: true, write: () => {} } };
  controller.request('microphoneLevel', {}, 1).catch(() => {});
  assert.equal(events.length, 0);
});

test('a timed out request terminates the unresponsive capture engine', async () => {
  const controller = new ObsController();
  let killed = false;
  controller.connected = true;
  controller.child = {
    killed: false,
    kill: () => { killed = true; },
    stdin: { writable: true, write: () => {} }
  };

  await assert.rejects(controller.request('start', {}, 1), /timed out while handling start/);

  assert.equal(killed, true);
  assert.equal(controller.child, null);
  assert.equal(controller.connected, false);
  assert.equal(controller.pending.size, 0);
});

test('a timed out request rejects other requests queued behind it', async () => {
  const controller = new ObsController();
  controller.connected = true;
  controller.child = {
    killed: false,
    kill: () => {},
    stdin: { writable: true, write: () => {} }
  };

  const blocked = controller.request('status', {}, 1000);
  const timedOut = controller.request('start', {}, 1);
  await assert.rejects(timedOut, /timed out while handling start/);
  await assert.rejects(blocked, /timed out while handling start/);
});
