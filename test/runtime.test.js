const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  RUNTIME_VERSION,
  REQUIRED_FILES,
  ensureRuntimeInstalled
} = require('../src/runtime');

test('a slim update refreshes native hosts in an otherwise-ready runtime', async (t) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clips-runtime-test-'));
  t.after(() => fs.promises.rm(temporary, { recursive: true, force: true }));
  const resources = path.join(temporary, 'resources');
  const runtime = path.join(temporary, `v${RUNTIME_VERSION}`);

  for (const relative of REQUIRED_FILES) {
    const target = path.join(runtime, relative);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, 'installed');
  }
  await fs.promises.writeFile(path.join(runtime, 'runtime.json'), JSON.stringify({
    version: RUNTIME_VERSION
  }));

  const bundledHost = path.join(resources, 'capture-host', 'clips-capture-host.exe');
  await fs.promises.mkdir(path.dirname(bundledHost), { recursive: true });
  await fs.promises.writeFile(bundledHost, 'updated capture host');
  const bundledFilters = path.join(resources, 'microphone-filters', 'obs-filters.dll');
  await fs.promises.mkdir(path.dirname(bundledFilters), { recursive: true });
  await fs.promises.writeFile(bundledFilters, 'updated microphone filters');
  await fs.promises.writeFile(path.join(resources, 'microphone-filters', 'nv-filters.dll'), 'updated nvidia filters');
  const bundledLibmpv = path.join(resources, 'libmpv');
  await fs.promises.mkdir(bundledLibmpv, { recursive: true });
  await fs.promises.writeFile(path.join(bundledLibmpv, 'mpv-host.exe'), 'updated mpv host');
  await fs.promises.writeFile(path.join(bundledLibmpv, 'libmpv-2.dll'), 'updated mpv library');

  const result = await ensureRuntimeInstalled(resources, runtime);
  assert.equal(result.installed, true);
  assert.equal(
    await fs.promises.readFile(
      path.join(runtime, 'libobs', 'bin', '64bit', 'clips-capture-host.exe'),
      'utf8'
    ),
    'updated capture host'
  );
  assert.equal(
    await fs.promises.readFile(path.join(runtime, 'libmpv', 'mpv-host.exe'), 'utf8'),
    'updated mpv host'
  );
  assert.equal(
    await fs.promises.readFile(path.join(runtime, 'libmpv', 'libmpv-2.dll'), 'utf8'),
    'updated mpv library'
  );
  assert.equal(
    await fs.promises.readFile(path.join(runtime, 'libobs', 'obs-plugins', '64bit', 'obs-filters.dll'), 'utf8'),
    'updated microphone filters'
  );
  assert.equal(
    await fs.promises.readFile(path.join(runtime, 'libobs', 'obs-plugins', '64bit', 'nv-filters.dll'), 'utf8'),
    'updated nvidia filters'
  );
});
