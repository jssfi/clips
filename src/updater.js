const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { verifyMetadata, verifyPackageMetadata } = require('../scripts/update-signature');
const UPDATE_PUBLIC_KEY = fs.readFileSync(path.join(__dirname, 'update-signing-public.pem'));

const execFileAsync = promisify(execFile);
const APP_EXECUTABLE = 'jss clips.exe';
const SEMVER = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';
const PREPARATION_DIRECTORY = new RegExp(`^${SEMVER}\\.preparing(?:-.+)?$`);
const VERSION_DIRECTORY = new RegExp(`^(${SEMVER})(?:\\.app-[A-Za-z0-9-]+)?$`);
const RETRYABLE_FILE_ERRORS = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);
const DOWNLOAD_STREAMS = 8;
const MINIMUM_DOWNLOAD_PART_SIZE = 8 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const STALE_PREPARATION_AGE_MS = 60 * 60 * 1000;

function updateRoot(app) {
  return path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'jss-clips');
}

function activeVersionPath(app) {
  return path.join(updateRoot(app), 'active-app.json');
}

function isVersionDirectory(name, version) {
  const candidate = String(name || '');
  return Boolean(parseVersion(version) && (
    candidate === version
    || (candidate.startsWith(`${version}.app-`) && /^[A-Za-z0-9-]+$/.test(candidate.slice(version.length + 5)))
  ));
}

function versionDirectory(app, version, directory = version) {
  if (!parseVersion(version) || !isVersionDirectory(directory, version)) {
    throw new Error('Invalid application version directory.');
  }
  return path.join(updateRoot(app), 'app-versions', directory);
}

function versionExecutable(app, version, directory = version) {
  return path.join(versionDirectory(app, version, directory), APP_EXECUTABLE);
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || ''));
  if (!match) return null;
  return { core: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') || [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : (a.prerelease.length ? -1 : 1);
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumber = /^\d+$/.test(a.prerelease[index]) ? Number(a.prerelease[index]) : null;
    const bNumber = /^\d+$/.test(b.prerelease[index]) ? Number(b.prerelease[index]) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? 1 : -1;
    if (aNumber !== null || bNumber !== null) return aNumber !== null ? -1 : 1;
    return a.prerelease[index] > b.prerelease[index] ? 1 : -1;
  }
  return 0;
}

function updateRelaunchArgs(args = process.argv.slice(1)) {
  return args.filter(argument => argument !== '--hidden');
}

function readActiveVersion(app) {
  try {
    const active = JSON.parse(fs.readFileSync(activeVersionPath(app), 'utf8'));
    if (!parseVersion(active.version)) return null;
    const directory = active.directory || active.version;
    if (!isVersionDirectory(directory, active.version)) return null;
    const executable = versionExecutable(app, active.version, directory);
    return fs.statSync(executable).size > 0
      ? { version: active.version, directory, executable }
      : null;
  } catch {
    return null;
  }
}

function redirectToActiveVersion(app) {
  if (!app.isPackaged) return false;
  const active = readActiveVersion(app);
  if (!active || compareVersions(active.version, app.getVersion()) <= 0) return false;
  if (path.resolve(process.execPath).toLowerCase() === path.resolve(active.executable).toLowerCase()) return false;
  spawn(active.executable, process.argv.slice(1), {
    cwd: path.dirname(active.executable),
    detached: true,
    windowsHide: false,
    stdio: 'ignore'
  }).unref();
  return true;
}

async function sha512(filePath) {
  const hash = crypto.createHash('sha512');
  await new Promise((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', resolve);
  });
  return hash.digest('base64');
}

function downloadRanges(size, streams = DOWNLOAD_STREAMS, minimumPartSize = MINIMUM_DOWNLOAD_PART_SIZE) {
  const count = Math.min(streams, Math.floor(size / minimumPartSize));
  if (count < 2) return [];
  const partSize = Math.ceil(size / count);
  return Array.from({ length: count }, (_value, index) => {
    const start = index * partSize;
    return { start, end: Math.min(size - 1, start + partSize - 1) };
  });
}

async function writeResponseBody(response, file, position, expectedSize, onBytes) {
  const reader = response.body.getReader();
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (received + chunk.length > expectedSize) {
      throw new Error('The update server returned too much data.');
    }
    await file.write(chunk, 0, chunk.length, position + received);
    received += chunk.length;
    onBytes(chunk.length);
  }
  if (received !== expectedSize) throw new Error('The update server returned an incomplete download.');
}

async function withFetchTimeout(fetchImpl, url, options, consume, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options?.signal;
  const abortFromExternal = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('The update request timed out.')), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The update request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

async function downloadInRanges(url, archive, size, ranges, onBytes, fetchImpl) {
  const controller = new AbortController();
  const file = await fs.promises.open(archive, 'w');
  try {
    await file.truncate(size);
    const downloads = ranges.map(async ({ start, end }) => {
      await withFetchTimeout(fetchImpl, url, {
        cache: 'no-store',
        headers: {
          'Accept-Encoding': 'identity',
          Range: `bytes=${start}-${end}`
        }, signal: controller.signal
      }, async response => {
        const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (
          response.status !== 206
          || !response.body
          || !contentRange
          || Number(contentRange[1]) !== start
          || Number(contentRange[2]) !== end
          || Number(contentRange[3]) !== size
        ) throw new Error('The update server does not support parallel downloads.');
        await writeResponseBody(response, file, start, end - start + 1, onBytes);
      });
    });
    try {
      await Promise.all(downloads);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(downloads);
      throw error;
    }
  } finally {
    await file.close();
  }
}

async function downloadInOneStream(url, archive, size, onBytes, fetchImpl) {
  await withFetchTimeout(fetchImpl, url, {
    cache: 'no-store',
    headers: { 'Accept-Encoding': 'identity' }
  }, async response => {
    if (!response.ok || !response.body) throw new Error(`Update download failed (${response.status}).`);
    const file = await fs.promises.open(archive, 'w');
    try { await writeResponseBody(response, file, 0, size, onBytes); }
    finally { await file.close(); }
  });
}

async function downloadUpdateArchive(url, archive, size, onProgress = () => {}, {
  fetchImpl = fetch,
  streams = DOWNLOAD_STREAMS,
  minimumPartSize = MINIMUM_DOWNLOAD_PART_SIZE
} = {}) {
  const ranges = downloadRanges(size, streams, minimumPartSize);
  let received = 0;
  const onBytes = bytes => {
    received += bytes;
    onProgress(received);
  };
  if (ranges.length) {
    try {
      await downloadInRanges(url, archive, size, ranges, onBytes, fetchImpl);
      return;
    } catch {
      received = 0;
      onProgress(0);
    }
  }
  await downloadInOneStream(url, archive, size, onBytes, fetchImpl);
}

function isPreparationDirectory(name) {
  return PREPARATION_DIRECTORY.test(String(name || ''));
}

async function removeWithRetries(target, { recursive = false } = {}) {
  for (let attempt = 0; attempt <= 8; attempt += 1) {
    try {
      await fs.promises.rm(target, { recursive, force: true });
      return;
    } catch (error) {
      if (!RETRYABLE_FILE_ERRORS.has(error?.code) || attempt === 8) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

async function cleanupStalePreparations(versions, { protectedDirectories = [] } = {}) {
  let entries;
  try {
    entries = await fs.promises.readdir(versions, { withFileTypes: true });
  } catch {
    return;
  }
  const protectedNames = new Set(protectedDirectories.filter(Boolean));
  const stale = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isPreparationDirectory(entry.name) || protectedNames.has(entry.name)) continue;
    try {
      const stat = await fs.promises.stat(path.join(versions, entry.name));
      if (Date.now() - stat.mtimeMs >= STALE_PREPARATION_AGE_MS) stale.push(entry.name);
    } catch {}
  }
  await Promise.allSettled(stale.map(name => removeWithRetries(path.join(versions, name), { recursive: true })));
}

async function renameWithRetries(source, destination, {
  rename = fs.promises.rename,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)),
  attempts = 20
} = {}) {
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (!RETRYABLE_FILE_ERRORS.has(error?.code) || attempt === attempts) throw error;
      await wait(Math.min(500, 50 * (attempt + 1)));
    }
  }
}

async function promotePreparedDirectory(source, destination, {
  rename = fs.promises.rename,
  copy = fs.promises.cp,
  remove = removeWithRetries,
  stat = fs.promises.stat,
  wait = delay => new Promise(resolve => setTimeout(resolve, delay)), expectedAsarSha512 = ''
} = {}) {
  try {
    await renameWithRetries(source, destination, { rename, wait, attempts: 4 });
    return;
  } catch (error) {
    if (!RETRYABLE_FILE_ERRORS.has(error?.code)) throw error;
  }

  await remove(destination, { recursive: true }).catch(() => {});
  await copy(source, destination, { recursive: true, force: false, errorOnExist: true });
  const executable = path.join(destination, APP_EXECUTABLE);
  const asar = path.join(destination, 'resources', 'app.asar');
  if ((await stat(executable)).size <= 0 || (await stat(asar)).size <= 0) {
    await remove(destination, { recursive: true }).catch(() => {});
    throw new Error('The promoted update is incomplete.');
  }
  if (expectedAsarSha512 && await sha512(asar) !== expectedAsarSha512) {
    await remove(destination, { recursive: true }).catch(() => {});
    throw new Error('The promoted application package failed its integrity check.');
  }
  await remove(source, { recursive: true }).catch(() => {});
}

async function cleanupInvalidPreparedVersions(versions, { protectedDirectories = [] } = {}) {
  let entries;
  try { entries = await fs.promises.readdir(versions, { withFileTypes: true }); }
  catch { return; }
  const protectedNames = new Set(protectedDirectories.filter(Boolean));
  await Promise.allSettled(entries.filter(entry => (
    entry.isDirectory()
    && entry.name.includes('.app-')
    && !protectedNames.has(entry.name)
  )).map(async entry => {
    const directory = path.join(versions, entry.name);
    try {
      const marker = JSON.parse(await fs.promises.readFile(path.join(directory, '.clips-update.json'), 'utf8'));
      if (!parseVersion(marker.version)
        || !isVersionDirectory(entry.name, marker.version)
        || (await fs.promises.stat(path.join(directory, APP_EXECUTABLE))).size <= 0
        || (await fs.promises.stat(path.join(directory, 'resources', 'app.asar'))).size <= 0) throw new Error('invalid');
    } catch {
      await removeWithRetries(directory, { recursive: true });
    }
  }));
}

async function cleanupOldVersionDirectories(versions, {
  protectedDirectories = [],
  retain = 2
} = {}) {
  let entries;
  try {
    entries = await fs.promises.readdir(versions, { withFileTypes: true });
  } catch {
    return;
  }
  const protectedNames = new Set(protectedDirectories.filter(Boolean));
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !VERSION_DIRECTORY.test(entry.name)) continue;
    try {
      const stat = await fs.promises.stat(path.join(versions, entry.name));
      candidates.push({ name: entry.name, modified: stat.mtimeMs });
    } catch {
      // A concurrently removed version needs no further cleanup.
    }
  }
  candidates.sort((left, right) => right.modified - left.modified);
  const keep = new Set(protectedNames);
  for (const candidate of candidates) {
    if (keep.size >= Math.max(1, retain)) break;
    keep.add(candidate.name);
  }
  await Promise.allSettled(candidates
    .filter(candidate => !keep.has(candidate.name))
    .map(candidate => removeWithRetries(path.join(versions, candidate.name), { recursive: true })));
}

async function cleanupOldVersions(app) {
  const root = updateRoot(app);
  const versions = path.join(root, 'app-versions');
  const active = readActiveVersion(app);
  const protectedDirectories = active ? [active.directory] : [];
  const runningDirectory = path.basename(path.dirname(process.execPath));
  const runningParent = path.resolve(path.dirname(path.dirname(process.execPath)));
  if (runningParent.toLowerCase() === path.resolve(versions).toLowerCase()) {
    protectedDirectories.push(runningDirectory);
  }
  await cleanupInvalidPreparedVersions(versions, { protectedDirectories });
  await cleanupOldVersionDirectories(versions, { protectedDirectories, retain: 2 });
}

async function findPreparedUpdate(app, metadata) {
  const versions = path.join(updateRoot(app), 'app-versions');
  let entries;
  try {
    entries = await fs.promises.readdir(versions, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isVersionDirectory(entry.name, metadata.version)) continue;
    const directory = versionDirectory(app, metadata.version, entry.name);
    const executable = path.join(directory, APP_EXECUTABLE);
    const asar = path.join(directory, 'resources', 'app.asar');
    try {
      const prepared = JSON.parse(await fs.promises.readFile(
        path.join(directory, '.clips-update.json'), 'utf8'
      ));
      if (
        prepared.version === metadata.version
        && prepared.sha512 === metadata.sha512
        && fs.statSync(executable).size > 0
        && fs.statSync(asar).size > 0
        && (!metadata.asarSha512 || await sha512(asar) === metadata.asarSha512)
      ) {
        candidates.push({
          version: metadata.version,
          directory: entry.name,
          executable,
          preparedAt: Date.parse(prepared.preparedAt) || 0
        });
      }
    } catch {
      // An incomplete directory has no valid marker and can never be activated.
    }
  }
  candidates.sort((left, right) => right.preparedAt - left.preparedAt);
  return candidates[0] || null;
}

function validateMetadata(value) {
  if (!value || !parseVersion(value.version) || typeof value.sha512 !== 'string') {
    throw new Error('The update feed returned invalid metadata.');
  }
  if (String(value.url || '') !== `jss-clips-app-${value.version}-x64.zip`) {
    throw new Error('The update feed returned an invalid package name.');
  }
  const size = Number(value.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('The update feed returned an invalid package size.');
  }
  const asarSha512 = typeof value.asarSha512 === 'string' ? value.asarSha512 : '';
  return { version: value.version, url: value.url, sha512: value.sha512, size, ...(asarSha512 ? { asarSha512 } : {}) };
}

function authenticateMetadata(value, publicKey = UPDATE_PUBLIC_KEY) {
  if (!verifyMetadata(value, publicKey)) throw new Error('The update feed signature is invalid.');
  if (value?.asarSha512 && !verifyPackageMetadata(value, publicKey)) throw new Error('The update package signature is invalid.');
  return validateMetadata(value);
}

function preparedUpdateMatches(prepared, metadata) {
  return Boolean(prepared && metadata
    && prepared.version === metadata.version
    && prepared.url === metadata.url
    && prepared.sha512 === metadata.sha512
    && prepared.size === metadata.size);
}

function createStagedUpdater({ app, feedUrl, onState }) {
  let operation = null;
  let readyUpdate = null;
  let readyMetadata = null;

  const emit = next => onState(next);
  const sevenZip = () => path.join(process.resourcesPath, 'tools', '7za.exe');
  const startupCleanup = cleanupOldVersions(app).catch(() => {});

  async function download(metadata) {
    const root = updateRoot(app);
    const downloads = path.join(root, 'app-downloads');
    const versions = path.join(root, 'app-versions');
    const operationId = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const archive = path.join(downloads, `${metadata.url}.${operationId}.download`);
    const directoryName = `${metadata.version}.app-${operationId}`;
    const preparationName = `${metadata.version}.preparing-${operationId}`;
    const destination = path.join(versions, preparationName);
    const finalDestination = versionDirectory(app, metadata.version, directoryName);
    let prepared = false;
    await fs.promises.mkdir(downloads, { recursive: true });
    await fs.promises.mkdir(versions, { recursive: true });
    await cleanupStalePreparations(versions, { protectedDirectories: [preparationName] });

    try {
      let lastPercent = -1;
      await downloadUpdateArchive(`${feedUrl}/${metadata.url}`, archive, metadata.size, received => {
        const percent = Math.min(99, Math.floor(received / metadata.size * 100));
        if (percent !== lastPercent) {
          lastPercent = percent;
          emit({ status: 'downloading', version: metadata.version, percent, message: '' });
        }
      });
      emit({ status: 'preparing', version: metadata.version, percent: 100, message: 'Preparing update…' });
      if ((await sha512(archive)) !== metadata.sha512) {
        throw new Error('The downloaded update failed its integrity check.');
      }
      if (!fs.existsSync(sevenZip())) throw new Error('The bundled update extractor is missing.');
      await execFileAsync(sevenZip(), ['x', '-y', `-o${destination}`, archive], {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      });
      const extractedExecutable = path.join(destination, APP_EXECUTABLE);
      const extractedAsar = path.join(destination, 'resources', 'app.asar');
      if (!fs.existsSync(extractedExecutable) || !fs.existsSync(extractedAsar)) {
        throw new Error('The prepared update is incomplete.');
      }
      await fs.promises.writeFile(path.join(destination, '.clips-update.json'), JSON.stringify({
        version: metadata.version,
        sha512: metadata.sha512,
        asarSha512: metadata.asarSha512,
        preparedAt: new Date().toISOString()
      }, null, 2));
      if (metadata.asarSha512 && await sha512(extractedAsar) !== metadata.asarSha512) throw new Error('The extracted application package failed its integrity check.');
      await promotePreparedDirectory(destination, finalDestination, { expectedAsarSha512: metadata.asarSha512 });
      prepared = true;
      return {
        version: metadata.version,
        directory: directoryName,
        executable: versionExecutable(app, metadata.version, directoryName)
      };
    } finally {
      await removeWithRetries(archive).catch(() => {});
      if (!prepared) await removeWithRetries(destination, { recursive: true }).catch(() => {});
    }
  }

  async function performCheck() {
    await startupCleanup;
    emit({ status: 'checking', message: '', percent: 0 });
    const metadata = await withFetchTimeout(fetch, `${feedUrl}/latest.json`, { cache: 'no-store' }, async response => {
      if (!response.ok) throw new Error(`Update check failed (${response.status}).`);
      return authenticateMetadata(await response.json());
    }, METADATA_TIMEOUT_MS);
    if (compareVersions(metadata.version, app.getVersion()) <= 0) {
      readyUpdate = null;
      readyMetadata = null;
      emit({ status: 'idle', version: app.getVersion(), percent: 0, message: '' });
      return false;
    }
    readyUpdate = await findPreparedUpdate(app, metadata);
    if (!readyUpdate) readyUpdate = await download(metadata);
    readyMetadata = metadata;
    emit({ status: 'ready', version: metadata.version, percent: 100, message: 'Restart to update' });
    return true;
  }

  function check() {
    if (operation) return operation;
    operation = performCheck()
      .catch(error => {
        emit({ status: 'error', percent: 0, message: error?.message || String(error) });
        return false;
      })
      .finally(() => { operation = null; });
    return operation;
  }

  async function restart(beforeRestart = async () => {}) {
    if (!readyUpdate || !fs.existsSync(readyUpdate.executable)) return false;
    let currentMetadata;
    try {
      currentMetadata = await withFetchTimeout(fetch, `${feedUrl}/latest.json`, { cache: 'no-store' }, async response => {
        if (!response.ok) throw new Error(`Update confirmation failed (${response.status}).`);
        return authenticateMetadata(await response.json());
      }, METADATA_TIMEOUT_MS);
    } catch (error) {
      emit({ status: 'error', percent: 0, message: `Could not confirm this update is still available: ${error?.message || error}` });
      return false;
    }
    if (!preparedUpdateMatches(readyMetadata, currentMetadata)) {
      readyUpdate = null;
      readyMetadata = null;
      if (compareVersions(currentMetadata.version, app.getVersion()) > 0) {
        emit({ status: 'checking', version: currentMetadata.version, percent: 0, message: 'The previous update was withdrawn. Getting the replacementâ€¦' });
        operation = performCheck().finally(() => { operation = null; });
        await operation.catch(error => {
          emit({ status: 'error', percent: 0, message: error?.message || String(error) });
        });
      } else {
        emit({ status: 'withdrawn', version: app.getVersion(), percent: 0, message: 'This update was withdrawn and will not be installed.' });
      }
      return false;
    }
    await beforeRestart();
    const pointer = activeVersionPath(app);
    await fs.promises.mkdir(path.dirname(pointer), { recursive: true });
    await fs.promises.writeFile(pointer, `${JSON.stringify({
      version: readyUpdate.version,
      directory: readyUpdate.directory,
      activatedAt: new Date().toISOString()
    }, null, 2)}\n`);
    app.isQuitting = true;
    app.relaunch({ execPath: readyUpdate.executable, args: updateRelaunchArgs() });
    app.exit(0);
    return true;
  }

  return { check, restart };
}

module.exports = {
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
  updateRelaunchArgs,
  redirectToActiveVersion,
  createStagedUpdater
};
