const test = require('node:test');
const assert = require('node:assert/strict');
const { createGateway } = require('../src/gateway');

const origin = 'https://clips.jss.fi';

async function withGateway(run) {
  const calls = [];
  const gateway = createGateway({
    token: 'a-secure-test-token',
    port: 0,
    allowedOrigins: [origin],
    approvePairing: async request => {
      calls.push(['pair', request]);
      return true;
    },
    invoke: async (method, args) => {
      calls.push([method, args]);
      return { method, args };
    }
  });
  const port = await gateway.start();
  try { await run({ gateway, port, calls }); }
  finally { gateway.close(); }
}

test('gateway only accepts the configured website origin', async () => withGateway(async ({ port }) => {
  const denied = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { Origin: 'https://example.com' } });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { Origin: origin } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await allowed.json(), { product: 'jss/clips', apiVersion: 1, pairingRequired: true });
}));

test('gateway accepts same-origin loopback requests that omit Origin', async () => withGateway(async ({ port }) => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), `http://127.0.0.1:${port}`);

  const events = await fetch(`http://127.0.0.1:${port}/v1/events?token=a-secure-test-token`);
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  assert.match(await reader.read().then(chunk => new TextDecoder().decode(chunk.value)), /connected/);
  await reader.cancel();
}));

test('gateway pairs and requires its capability for RPC', async () => withGateway(async ({ port, calls }) => {
  const endpoint = `http://127.0.0.1:${port}/v1`;
  const unauthenticated = await fetch(`${endpoint}/rpc`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(unauthenticated.status, 401);

  const pairing = await fetch(`${endpoint}/pair`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientName: 'Test browser' })
  });
  assert.deepEqual(await pairing.json(), { token: 'a-secure-test-token', apiVersion: 1 });
  assert.equal(calls[0][0], 'pair');

  const rpc = await fetch(`${endpoint}/rpc`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer a-secure-test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'getState', args: [1] })
  });
  assert.deepEqual(await rpc.json(), { result: { method: 'getState', args: [1] } });
}));

test('gateway advertises local-network preflight permission', async () => withGateway(async ({ port }) => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/rpc`, {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Private-Network': 'true' }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-private-network'), 'true');
}));
