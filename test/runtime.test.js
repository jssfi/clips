const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  RUNTIME_VERSION,
  REQUIRED_FILES,
  isRuntimeReady,
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
  const bundledAmfProbe = path.join(resources, 'encoder-probes', 'obs-amf-test.exe');
  await fs.promises.mkdir(path.dirname(bundledAmfProbe), { recursive: true });
  await fs.promises.writeFile(bundledAmfProbe, 'updated amf probe');
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
    await fs.promises.readFile(path.join(runtime, 'libobs', 'bin', '64bit', 'obs-amf-test.exe'), 'utf8'),
    'updated amf probe'
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
  assert.equal(isRuntimeReady(runtime), true);
});

test('a failed runtime installation leaves the existing runtime untouched', async (t) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clips-runtime-test-'));
  t.after(() => fs.promises.rm(temporary, { recursive: true, force: true }));
  const resources = path.join(temporary, 'resources');
  const runtime = path.join(temporary, `v${RUNTIME_VERSION}`);
  await fs.promises.mkdir(runtime, { recursive: true });
  await fs.promises.writeFile(path.join(runtime, 'keep.txt'), 'previous runtime');

  await fs.promises.mkdir(path.join(resources, 'libobs', 'bin', '64bit'), { recursive: true });
  await fs.promises.writeFile(path.join(resources, 'libobs', 'bin', '64bit', 'obs.dll'), 'partial');
  await fs.promises.mkdir(path.join(resources, 'ffmpeg'), { recursive: true });
  await fs.promises.writeFile(path.join(resources, 'ffmpeg', 'ffmpeg.exe'), 'ffmpeg');
  await fs.promises.mkdir(path.join(resources, 'libmpv'), { recursive: true });
  await fs.promises.writeFile(path.join(resources, 'libmpv', 'mpv-host.exe'), 'host');
  await fs.promises.writeFile(path.join(resources, 'libmpv', 'libmpv-2.dll'), 'library');

  await assert.rejects(ensureRuntimeInstalled(resources, runtime));
  assert.equal(await fs.promises.readFile(path.join(runtime, 'keep.txt'), 'utf8'), 'previous runtime');
  assert.equal(fs.existsSync(path.join(runtime, 'libobs')), false);
  assert.deepEqual(
    (await fs.promises.readdir(temporary)).filter(name => name.includes('.install-')),
    []
  );
});

test('runtime hashes detect corruption while legacy manifests remain compatible', async (t) => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clips-runtime-test-'));
  t.after(() => fs.promises.rm(temporary, { recursive: true, force: true }));
  for (const relative of REQUIRED_FILES) {
    const target = path.join(temporary, relative);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, 'installed');
  }
  await fs.promises.writeFile(path.join(temporary, 'runtime.json'), JSON.stringify({
    version: RUNTIME_VERSION
  }));
  assert.equal(isRuntimeReady(temporary), true);

  const relative = REQUIRED_FILES[0];
  await fs.promises.writeFile(path.join(temporary, 'runtime.json'), JSON.stringify({
    version: RUNTIME_VERSION,
    files: { [relative.replaceAll('\\', '/')]: 'invalid-hash' }
  }));
  assert.equal(isRuntimeReady(temporary), false);
});
