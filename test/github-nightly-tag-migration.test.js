const test = require('node:test');
const assert = require('node:assert/strict');

let migration;
test.before(async () => { migration = await import('../scripts/migrate-github-nightly-tags.mjs'); });

function release(id, tag, overrides = {}) {
  return {
    id,
    tag_name: tag,
    name: `Release ${id}`,
    body: `Body ${id}`,
    draft: false,
    prerelease: true,
    assets: [],
    ...overrides
  };
}

test('legacy numeric nightly tags migrate to fixed-width alphanumeric identifiers', () => {
  assert.equal(
    migration.migratedTag('v0.5.0-nightly.19.77e9a876'),
    'v0.5.0-nightly.n000019.77e9a876'
  );
  assert.equal(migration.migratedTag('v0.5.0-nightly.n000019.77e9a876'), null);
  assert.equal(migration.migratedTag('v0.5.0'), null);
});

test('migration rejects sequences outside the fixed-width range', () => {
  assert.throws(
    () => migration.migratedTag('v0.5.0-nightly.1000000.77e9a876'),
    /cannot be represented/
  );
});

test('plan includes only matching prereleases and preserves release snapshots', () => {
  const releases = [
    release(1, 'v0.5.0-nightly.9.aaaaaaaa', { assets: [{ id: 4, name: 'app.zip', size: 12, state: 'uploaded' }] }),
    release(2, 'v0.5.0-nightly.n000010.bbbbbbbb'),
    release(3, 'v0.5.0', { prerelease: false })
  ];
  const plan = migration.buildPlan(releases);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].newTag, 'v0.5.0-nightly.n000009.aaaaaaaa');
  assert.deepEqual(plan[0].fingerprint.assets, [{ id: 4, name: 'app.zip', label: undefined, size: 12, state: 'uploaded', digest: null }]);
});

test('plan fails before mutation when a destination release exists', () => {
  assert.throws(
    () => migration.buildPlan([
      release(1, 'v0.5.0-nightly.9.aaaaaaaa'),
      release(2, 'v0.5.0-nightly.n000009.aaaaaaaa')
    ]),
    /already belongs/
  );
});

test('sortable tags order sequences lexically across digit boundaries', () => {
  assert.doesNotThrow(() => migration.assertSortableTags([
    'v0.5.0-nightly.n000019.aaaaaaaa',
    'v0.5.0-nightly.n000010.bbbbbbbb',
    'v0.5.0-nightly.n000009.cccccccc',
    'v0.5.0-nightly.n000001.dddddddd',
    'v0.5.0'
  ]));
});

test('apply mode requires an exact repository confirmation', () => {
  assert.throws(() => migration.parseArguments(['--apply']), /--confirm-retag=jssfi\/clips/);
  assert.equal(
    migration.parseArguments(['--apply', '--confirm-retag=jssfi/clips']).apply,
    true
  );
});

test('apply and verification modes are mutually exclusive', () => {
  assert.throws(
    () => migration.parseArguments(['--apply', '--verify-only', '--confirm-retag=jssfi/clips']),
    /cannot be combined/
  );
});
