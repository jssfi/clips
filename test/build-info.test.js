const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { releaseConfigFromEnv, verifyRuntimeAbi } = require('../scripts/write-build-info');

test('release configuration supports every endpoint combination independently', () => {
  assert.deepEqual(releaseConfigFromEnv({}), {});
  assert.deepEqual(releaseConfigFromEnv({ CLIPS_UPDATE_URL: 'https://updates.example.test/' }), {
    updateUrl: 'https://updates.example.test'
  });
  assert.deepEqual(releaseConfigFromEnv({ CLIPS_TELEMETRY_URL: 'https://telemetry.example.test/' }), {
    telemetryUrl: 'https://telemetry.example.test'
  });
  assert.deepEqual(releaseConfigFromEnv({
    CLIPS_UPDATE_URL: 'https://updates.example.test/cdn/',
    CLIPS_TELEMETRY_URL: 'https://telemetry.example.test/events/'
  }), {
    updateUrl: 'https://updates.example.test/cdn',
    telemetryUrl: 'https://telemetry.example.test/events'
  });
});

test('release configuration rejects insecure configured endpoints', () => {
  assert.throws(() => releaseConfigFromEnv({ CLIPS_UPDATE_URL: 'http://updates.example.test' }), /HTTPS/);
  assert.throws(() => releaseConfigFromEnv({ CLIPS_TELEMETRY_URL: 'file://telemetry' }), /HTTPS/);
});

test('release builds fail closed when staged OBS changes without a runtime ABI bump', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-runtime-abi-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const obsPath = path.join(directory, 'obs.dll');
  const manifestPath = path.join(directory, 'runtime-abi.json');
  fs.writeFileSync(obsPath, 'pinned obs runtime');
  fs.writeFileSync(manifestPath, JSON.stringify({
    runtimeVersion: 2,
    obsSha256: crypto.createHash('sha256').update('pinned obs runtime').digest('hex')
  }));
  assert.equal(verifyRuntimeAbi({ manifestPath, obsPath }).runtimeVersion, 2);
  fs.writeFileSync(obsPath, 'different obs runtime');
  assert.throws(() => verifyRuntimeAbi({ manifestPath, obsPath }), /changed without an ABI declaration/);
});
