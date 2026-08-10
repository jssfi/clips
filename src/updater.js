const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const APP_EXECUTABLE = 'jss clips.exe';
const SEMVER = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';
const PREPARATION_DIRECTORY = new RegExp(`^${SEMVER}\\.preparing(?:-.+)?$`);
const VERSION_DIRECTORY = new RegExp(`^(${SEMVER})(?:\\.app-[A-Za-z0-9-]+)?$`);
const RETRYABLE_FILE_ERRORS = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);

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

async function cleanupStalePreparations(versions) {
  let entries;
  try {
    entries = await fs.promises.readdir(versions, { withFileTypes: true });
  } catch {
    return;
  }
  const stale = entries.filter(entry => entry.isDirectory() && isPreparationDirectory(entry.name));
  await Promise.allSettled(stale.map(entry => (
    removeWithRetries(path.join(versions, entry.name), { recursive: true })
  )));
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
  return { version: value.version, url: value.url, sha512: value.sha512, size };
}

function createStagedUpdater({ app, feedUrl, onState }) {
  let operation = null;
  let readyUpdate = null;

  const emit = next => onState(next);
  const sevenZip = () => path.join(process.resourcesPath, 'tools', '7za.exe');
  cleanupOldVersions(app).catch(() => {});

  async function download(metadata) {
    const root = updateRoot(app);
    const downloads = path.join(root, 'app-downloads');
    const versions = path.join(root, 'app-versions');
    const operationId = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const archive = path.join(downloads, `${metadata.url}.${operationId}.download`);
    const directoryName = `${metadata.version}.app-${operationId}`;
    const destination = versionDirectory(app, metadata.version, directoryName);
    let prepared = false;
    await fs.promises.mkdir(downloads, { recursive: true });
    await fs.promises.mkdir(versions, { recursive: true });
    cleanupStalePreparations(versions).catch(() => {});

    try {
      const response = await fetch(`${feedUrl}/${metadata.url}`, { cache: 'no-store' });
      if (!response.ok || !response.body) throw new Error(`Update download failed (${response.status}).`);
      const file = await fs.promises.open(archive, 'w');
      let received = 0;
      let lastPercent = -1;
      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          await file.write(chunk);
          received += chunk.length;
          const percent = Math.min(99, Math.floor(received / metadata.size * 100));
          if (percent !== lastPercent) {
            lastPercent = percent;
            emit({ status: 'downloading', version: metadata.version, percent, message: '' });
          }
        }
      } finally {
        await file.close();
      }
      if (received !== metadata.size) throw new Error('The downloaded update has the wrong size.');
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
        preparedAt: new Date().toISOString()
      }, null, 2));
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
    emit({ status: 'checking', message: '', percent: 0 });
    const response = await fetch(`${feedUrl}/latest.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Update check failed (${response.status}).`);
    const metadata = validateMetadata(await response.json());
    if (compareVersions(metadata.version, app.getVersion()) <= 0) {
      readyUpdate = null;
      emit({ status: 'idle', version: app.getVersion(), percent: 0, message: '' });
      return false;
    }
    readyUpdate = await findPreparedUpdate(app, metadata);
    if (!readyUpdate) readyUpdate = await download(metadata);
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

  async function restart() {
    if (!readyUpdate || !fs.existsSync(readyUpdate.executable)) return false;
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
  isPreparationDirectory,
  isVersionDirectory,
  validateMetadata,
  updateRelaunchArgs,
  redirectToActiveVersion,
  createStagedUpdater
};
