const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { signMetadata } = require('../scripts/update-signature');
const {
  compareVersions,
  cleanupOldVersionDirectories,
  cleanupStalePreparations,
  cleanupInvalidPreparedVersions,
  isPreparationDirectory,
  isVersionDirectory,
  validateMetadata,
  authenticateMetadata,
  preparedUpdateMatches,
  downloadRanges,
  downloadUpdateArchive,
  withFetchTimeout,
  renameWithRetries,
  promotePreparedDirectory,
  updateRelaunchArgs
} = require('../src/updater');

test('update restarts discard background startup without changing other arguments', () => {
  assert.deepEqual(updateRelaunchArgs(['--hidden', '--trace-warnings']), ['--trace-warnings']);
  assert.deepEqual(updateRelaunchArgs(['--trace-warnings']), ['--trace-warnings']);
});

test('old app versions are pruned while active and rollback versions are retained', async t => {
  const versions = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-versions-'));
  t.after(() => fs.rmSync(versions, { recursive: true, force: true }));
  const names = ['0.1.50.app-old', '0.1.51.app-active', '0.1.52.app-new'];
  for (const [index, name] of names.entries()) {
    const directory = path.join(versions, name);
    fs.mkdirSync(directory);
    const timestamp = new Date(2026, 0, index + 1);
    fs.utimesSync(directory, timestamp, timestamp);
  }

  await cleanupOldVersionDirectories(versions, {
    protectedDirectories: ['0.1.51.app-active'],
    retain: 2
  });

  assert.deepEqual(fs.readdirSync(versions).sort(), [
    '0.1.51.app-active',
    '0.1.52.app-new'
  ]);
});

test('compareVersions orders patch releases', () => {
  assert.equal(compareVersions('0.1.12', '0.1.11'), 1);
  assert.equal(compareVersions('0.1.11', '0.1.12'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('compareVersions orders commit nightlies after their stable base', () => {
  assert.equal(compareVersions('0.3.1-nightly.42.bbbbbbbb', '0.3.0'), 1);
  assert.equal(compareVersions('0.3.1-nightly.43.aaaaaaaa', '0.3.1-nightly.42.bbbbbbbb'), 1);
});

test('isPreparationDirectory recognizes fixed and unique updater staging directories', () => {
  assert.equal(isPreparationDirectory('0.1.13.preparing'), true);
  assert.equal(isPreparationDirectory('0.1.14.preparing-1234-5678-abcd'), true);
  assert.equal(isPreparationDirectory('0.1.14'), false);
  assert.equal(isPreparationDirectory('../0.1.14.preparing'), false);
});

test('isVersionDirectory accepts only safe canonical and immutable version directories', () => {
  assert.equal(isVersionDirectory('0.1.17', '0.1.17'), true);
  assert.equal(isVersionDirectory('0.1.17.app-1234-5678-abcd', '0.1.17'), true);
  assert.equal(isVersionDirectory('0.1.16.app-1234', '0.1.17'), false);
  assert.equal(isVersionDirectory('0.1.17.preparing', '0.1.17'), false);
  assert.equal(isVersionDirectory('../0.1.17.app-1234', '0.1.17'), false);
  assert.equal(isVersionDirectory('0.3.1-nightly.42.a1b2c3d4.app-1234', '0.3.1-nightly.42.a1b2c3d4'), true);
});

test('validateMetadata accepts a matching immutable application package', () => {
  assert.deepEqual(validateMetadata({
    version: '0.1.12',
    url: 'jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123
  }), {
    version: '0.1.12',
    url: 'jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123
  });
});

test('validateMetadata accepts a commit nightly package', () => {
  const version = '0.3.1-nightly.42.a1b2c3d4';
  assert.equal(validateMetadata({ version, url: `jss-clips-app-${version}-x64.zip`, sha512: 'checksum', size: 123 }).version, version);
});

test('validateMetadata rejects traversal and mismatched versions', () => {
  assert.throws(() => validateMetadata({
    version: '0.1.12',
    url: '../jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123
  }));
  assert.throws(() => validateMetadata({
    version: '0.1.12',
    url: 'jss-clips-app-0.1.13-x64.zip',
    sha512: 'checksum',
    size: 123
  }));
});

test('authenticateMetadata accepts only metadata signed by the trusted key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const metadata = {
    version: '0.1.12',
    url: 'jss-clips-app-0.1.12-x64.zip',
    sha512: 'checksum',
    size: 123,
    releaseDate: '2026-08-10T00:00:00.000Z'
  };
  metadata.signature = signMetadata(metadata, privateKey);
  assert.equal(authenticateMetadata(metadata, publicKey).version, '0.1.12');
  assert.throws(() => authenticateMetadata({ ...metadata, size: 124 }, publicKey), /signature/i);
  assert.throws(() => authenticateMetadata({ ...metadata, signature: '' }, publicKey), /signature/i);
});

test('restart confirmation requires the exact prepared update metadata', () => {
  const prepared = { version: '0.1.12', url: 'jss-clips-app-0.1.12-x64.zip', sha512: 'one', size: 123 };
  assert.equal(preparedUpdateMatches(prepared, { ...prepared }), true);
  assert.equal(preparedUpdateMatches(prepared, { ...prepared, version: '0.1.13' }), false);
  assert.equal(preparedUpdateMatches(prepared, { ...prepared, sha512: 'two' }), false);
  assert.equal(preparedUpdateMatches(prepared, { ...prepared, size: 124 }), false);
});

test('downloadRanges splits large updates into complete non-overlapping parts', () => {
  assert.deepEqual(downloadRanges(10, 4, 3), [
    { start: 0, end: 3 },
    { start: 4, end: 7 },
    { start: 8, end: 9 }
  ]);
  assert.deepEqual(downloadRanges(5, 4, 3), []);
});

test('update archives download over parallel byte ranges', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-download-'));
  const archive = path.join(temporary, 'update.zip');
  const source = Buffer.from('a fast update delivered in several independently verified pieces');
  const requestedRanges = [];
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  await downloadUpdateArchive('https://updates.example/update.zip', archive, source.length, () => {}, {
    streams: 4,
    minimumPartSize: 8,
    fetchImpl: async (_url, options) => {
      requestedRanges.push(options.headers.Range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      const start = Number(match[1]);
      const end = Number(match[2]);
      return new Response(source.subarray(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${source.length}` }
      });
    }
  });

  assert.equal(requestedRanges.length, 4);
  assert.deepEqual(fs.readFileSync(archive), source);
});

test('update archive download falls back when byte ranges are unsupported', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-download-fallback-'));
  const archive = path.join(temporary, 'update.zip');
  const source = Buffer.from('a complete update from an older server');
  let fullRequests = 0;
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  await downloadUpdateArchive('https://updates.example/update.zip', archive, source.length, () => {}, {
    streams: 4,
    minimumPartSize: 8,
    fetchImpl: async (_url, options) => {
      if (options.headers.Range) return new Response(source, { status: 200 });
      fullRequests += 1;
      return new Response(source, { status: 200 });
    }
  });

  assert.equal(fullRequests, 1);
  assert.deepEqual(fs.readFileSync(archive), source);
});

test('update requests abort stalled connections and bodies', async () => {
  await assert.rejects(
    withFetchTimeout((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), 'https://updates.example/latest.json', {}, async () => {}, 10),
    /timed out/
  );
  await assert.rejects(
    withFetchTimeout(async (_url, { signal }) => new Response(new ReadableStream({ start(controller) {
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    } })), 'https://updates.example/app.zip', {}, async response => {
      await response.arrayBuffer();
    }, 10),
    /timed out/
  );
});

test('incomplete final-looking update directories are removed before retention', async t => {
  const versions = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-invalid-version-'));
  t.after(() => fs.rmSync(versions, { recursive: true, force: true }));
  const invalid = path.join(versions, '0.5.0-nightly.4.deadbeef.app-crashed');
  fs.mkdirSync(invalid);
  fs.writeFileSync(path.join(invalid, '.clips-update.json'), JSON.stringify({ version: '0.5.0-nightly.4.deadbeef' }));
  await cleanupInvalidPreparedVersions(versions);
  assert.equal(fs.existsSync(invalid), false);
});

test('invalid-package cleanup never removes an active or running version directory', async t => {
  const versions = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-protected-version-'));
  t.after(() => fs.rmSync(versions, { recursive: true, force: true }));
  const protectedName = '0.5.0-nightly.4.deadbeef.app-running';
  const unprotectedName = '0.5.0-nightly.3.cafebabe.app-abandoned';
  fs.mkdirSync(path.join(versions, protectedName));
  fs.mkdirSync(path.join(versions, unprotectedName));

  await cleanupInvalidPreparedVersions(versions, {
    protectedDirectories: [protectedName]
  });

  assert.equal(fs.existsSync(path.join(versions, protectedName)), true);
  assert.equal(fs.existsSync(path.join(versions, unprotectedName)), false);
});

test('stale preparation cleanup cannot delete the update currently being prepared', async t => {
  const versions = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-preparation-cleanup-'));
  t.after(() => fs.rmSync(versions, { recursive: true, force: true }));
  const current = '0.5.0-nightly.6.deadbeef.preparing-current';
  const stale = '0.5.0-nightly.5.cafebabe.preparing-stale';
  fs.mkdirSync(path.join(versions, current));
  fs.mkdirSync(path.join(versions, stale));

  await cleanupStalePreparations(versions, { protectedDirectories: [current] });

  assert.equal(fs.existsSync(path.join(versions, current)), true);
  assert.equal(fs.existsSync(path.join(versions, stale)), false);
});

test('prepared update finalization retries transient Windows directory locks', async () => {
  let attempts = 0;
  const delays = [];
  await renameWithRetries('preparing', 'final', {
    rename: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    },
    wait: async delay => { delays.push(delay); }
  });

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [50, 100]);
});

test('prepared update promotion copies and verifies when Windows keeps the directory locked', async () => {
  const copied = [];
  const removed = [];
  await promotePreparedDirectory('preparing', 'final', {
    rename: async () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); },
    wait: async () => {},
    copy: async (...args) => { copied.push(args); },
    stat: async file => ({ size: file.endsWith('app.asar') ? 200 : 100 }),
    remove: async name => { removed.push(name); }
  });
  assert.equal(copied.length, 1);
  assert.deepEqual(removed, ['final', 'preparing']);
});
