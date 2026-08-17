import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactName, parseRange, serve } from '../src/updates.ts';
import { serveTelemetry } from '../src/telemetry.ts';

function r2Object(body, overrides = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    size: bytes.byteLength,
    httpEtag: '"test-etag"',
    body: new Blob([bytes]).stream(),
    writeHttpMetadata() {},
    ...overrides
  };
}

test('update routes reject traversal and parse complete byte ranges', () => {
  assert.equal(artifactName('/stable/../latest.json'), null);
  assert.equal(artifactName('/jss-clips-app-0.5.0-x64.zip')?.key, 'releases/jss-clips-app-0.5.0-x64.zip');
  assert.deepEqual(parseRange('bytes=10-19', 100), { offset: 10, length: 10 });
  assert.deepEqual(parseRange('bytes=-12', 100), { suffix: 12 });
  assert.equal(parseRange('bytes=100-101', 100), null);
  assert.equal(parseRange('bytes=20-10', 100), null);
});

test('update serving returns correct range and conditional statuses', async () => {
  const object = r2Object('0123456789');
  const bucket = {
    async head() { return object; },
    async get(_key, options) {
      if (options?.onlyIf?.get('if-none-match')) {
        const { body: _body, ...conditional } = object;
        return conditional;
      }
      if (options?.range) return r2Object('2345', { size: 10, range: options.range });
      return object;
    }
  };
  const partial = await serve(new Request('https://clips.test/jss-clips-app-0.5.0-x64.zip', {
    headers: { Range: 'bytes=2-5' }
  }), bucket);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await partial.text(), '2345');

  const invalid = await serve(new Request('https://clips.test/jss-clips-app-0.5.0-x64.zip', {
    headers: { Range: 'bytes=20-30' }
  }), bucket);
  assert.equal(invalid.status, 416);

  const conditional = await serve(new Request('https://clips.test/latest.json', {
    headers: { 'If-None-Match': '"test-etag"' }
  }), bucket);
  assert.equal(conditional.status, 304);
});

test('telemetry rejects malformed and oversized events before writing R2', async () => {
  let writes = 0;
  const bucket = { async put() { writes += 1; } };
  const malformed = await serveTelemetry(new Request('https://clips.test/v1/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
  }), bucket);
  assert.equal(malformed.status, 400);

  const oversized = await serveTelemetry(new Request('https://clips.test/v1/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) })
  }), bucket);
  assert.equal(oversized.status, 413);
  assert.equal(writes, 0);
});

test('telemetry stores a valid version-only event without diagnostic fields', async () => {
  const writes = [];
  const bucket = { async put(key, body, options) { writes.push({ key, body: JSON.parse(body), options }); } };
  const event = {
    schemaVersion: 1,
    installationId: '123e4567-e89b-42d3-a456-426614174000',
    mode: 'version',
    event: 'startup',
    timestamp: new Date().toISOString(),
    appVersion: '0.5.0-nightly.17.0ae82234',
    runtimeVersion: '2'
  };
  const response = await serveTelemetry(new Request('https://clips.test/v1/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event)
  }), bucket);
  assert.equal(response.status, 202);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, `installations/${event.installationId}.json`);
  assert.equal(writes[0].body.system, undefined);
});
