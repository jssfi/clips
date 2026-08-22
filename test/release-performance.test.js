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

test('release retention keeps the newest three complete version groups', async () => {
  const { artifactVersion, releaseRetentionPlan } = await import('../clips-worker/scripts/release-utils.mjs');
  const versions = [
    '0.6.0-nightly.n000009.aaaaaaaa',
    '0.6.0-nightly.n000012.dddddddd',
    '0.6.0-nightly.n000010.bbbbbbbb',
    '0.6.0-nightly.n000011.cccccccc'
  ];
  const objects = versions.flatMap(version => [
    { Key: `releases/jss-clips-update-${version}-x64.exe`, Size: 100 },
    { Key: `releases/jss-clips-source-${version}.zip`, Size: 50 }
  ]);
  objects.push({ Key: 'releases/latest.json', Size: 1 });

  assert.equal(artifactVersion('releases/stable/jss-clips-app-0.6.0-x64.zip'), '0.6.0');
  assert.equal(artifactVersion('releases/latest.yml'), null);
  assert.deepEqual(releaseRetentionPlan(objects), {
    retainedVersions: versions.slice(1).sort().reverse(),
    deletedVersions: [versions[0]],
    deleteObjects: objects.slice(0, 2)
  });
});

test('release retention understands stable and legacy nightly version ordering', async () => {
  const { compareReleaseVersions, releaseRetentionPlan } = await import('../clips-worker/scripts/release-utils.mjs');
  assert.ok(compareReleaseVersions('0.6.0', '0.6.0-nightly.n000099.aaaaaaaa') > 0);
  assert.ok(compareReleaseVersions('0.6.0-nightly.n000001.bbbbbbbb', '0.5.0-nightly.20.aaaaaaaa') > 0);
  const objects = ['0.4.0', '0.5.0', '0.6.0', '0.7.0'].map(version => ({
    Key: `releases/stable/jss-clips-setup-${version}-x64.exe`,
    Size: 100
  }));
  assert.deepEqual(releaseRetentionPlan(objects).deletedVersions, ['0.4.0']);
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
