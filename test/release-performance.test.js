const test = require('node:test');
const assert = require('node:assert/strict');

test('release upload limiter enforces concurrency while completing every task', async () => {
  const { limiter } = await import('../clips-worker/scripts/release-utils.mjs');
  const schedule = limiter(3);
  let active = 0;
  let maximum = 0;
  const completed = [];
  await Promise.all(Array.from({ length: 12 }, (_, index) => schedule(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setImmediate(resolve));
    completed.push(index);
    active -= 1;
  })));
  assert.equal(maximum, 3);
  assert.deepEqual(completed.sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index));
});

test('dual update metadata publication rolls back the first feed on partial failure', async () => {
  const { publishMetadataPair } = await import('../clips-worker/scripts/release-utils.mjs');
  const live = new Map([['latest.json', 'old-json'], ['latest.yml', 'old-yml']]);
  await assert.rejects(publishMetadataPair(['latest.json', 'latest.yml'], {
    readPrevious: async name => live.get(name) ?? null,
    publishAndVerify: async name => {
      if (name === 'latest.yml') throw new Error('injected second-write failure');
      live.set(name, 'new-json');
    },
    restore: async (name, body) => live.set(name, body),
    remove: async name => live.delete(name)
  }), /rolled back/);
  assert.equal(live.get('latest.json'), 'old-json');
  assert.equal(live.get('latest.yml'), 'old-yml');
});
