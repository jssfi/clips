const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseConfigFromEnv } = require('../scripts/write-build-info');

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
  assert.throws(() => releaseConfigFromEnv({ CLIPS_TELEMETRY_URL: 'file:\/\/telemetry' }), /HTTPS/);
});
