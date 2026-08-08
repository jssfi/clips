const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeLog, createTelemetry } = require('../src/telemetry');

test('log sanitization removes configured and Windows paths', () => {
  const value = sanitizeLog('user C:\\Users\\Alice\\Videos\\Clips and D:\\private\\file.mkv', ['C:\\Users\\Alice']);
  assert.equal(value.includes('Alice'), false);
  assert.equal(value.includes('private'), false);
});

test('version telemetry contains no specs or logs', async () => {
  let body;
  const telemetry = createTelemetry({
    endpoint: 'https://example.com', mode: 'version', installationId: '00000000-0000-4000-8000-000000000000',
    appVersion: '1.2.3', runtimeVersion: '4', system: { cpu: 'secret' }, logger: { warn() {} },
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return { ok: true }; }
  });
  await telemetry.sendStartup();
  assert.deepEqual(Object.keys(body).sort(), ['appVersion', 'event', 'installationId', 'mode', 'runtimeVersion', 'schemaVersion', 'timestamp'].sort());
});

test('off telemetry never performs a request', async () => {
  let requests = 0;
  const telemetry = createTelemetry({ endpoint: 'https://example.com', mode: 'off', fetchImpl: async () => { requests++; } });
  await telemetry.sendStartup();
  assert.equal(requests, 0);
});
