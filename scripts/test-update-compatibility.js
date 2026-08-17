const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'latest.json'), 'utf8'));
const archive = path.join(root, 'dist', metadata.url);
const clients = [
  { tag: 'v0.2.2', version: '0.2.2', channel: 'stable', stableOnly: true },
  { tag: 'v0.4.0', version: '0.4.0', channel: 'stable' },
  { tag: 'v0.4.1-nightly.33.4ce5c2d0', version: '0.4.1-nightly.33.4ce5c2d0', channel: 'nightly' },
  { tag: 'v0.5.0-nightly.1.349ce990', version: '0.5.0-nightly.1.349ce990', channel: 'nightly' }
];

function gitFile(tag, file) {
  return execFileSync('git', ['show', `${tag}:${file}`], { cwd: root });
}

function gitHasFile(tag, file) {
  try {
    execFileSync('git', ['cat-file', '-e', `${tag}:${file}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sha512(file) {
  const hash = crypto.createHash('sha512');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const length = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!length) break;
      hash.update(buffer.subarray(0, length));
    }
    return hash.digest('base64');
  } finally {
    fs.closeSync(descriptor);
  }
}

assert.equal(fs.statSync(archive).size, metadata.size, 'Staged archive size does not match latest.json.');
assert.equal(sha512(archive), metadata.sha512, 'Staged archive hash does not match latest.json.');
assert.equal(metadata.url, `jss-clips-app-${metadata.version}-x64.zip`);

const stagedClients = [];
for (const client of clients) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-compatibility-'));
  try {
    for (const directory of ['src', 'scripts']) fs.mkdirSync(path.join(temporary, directory), { recursive: true });
    const files = ['src/updater.js', 'src/update-signing-public.pem', 'scripts/update-signature.js']
      .filter(file => gitHasFile(client.tag, file));
    for (const file of files) {
      fs.writeFileSync(path.join(temporary, file), gitFile(client.tag, file));
    }
    const updater = require(path.join(temporary, 'src', 'updater.js'));
    const authenticate = updater.authenticateMetadata || updater.validateMetadata;
    if (client.stableOnly && metadata.version.includes('-')) {
      assert.throws(() => authenticate(metadata));
      console.log(`${client.channel} client ${client.version} correctly requires a stable SemVer bridge release; nightly metadata is not compatible.`);
      continue;
    }
    const accepted = authenticate(metadata);
    assert.equal(accepted.version, metadata.version);
    assert.equal(updater.compareVersions(metadata.version, client.version) > 0, true);
    assert.equal(accepted.url, metadata.url);
    assert.equal(accepted.size, fs.statSync(archive).size);
    console.log(`${client.channel} client ${client.version} authenticates update ${metadata.version} and its staged artifact.`);
    if (client.tag === 'v0.4.1-nightly.33.4ce5c2d0' || client.tag === 'v0.2.2') {
      stagedClients.push({ client, updater });
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function exerciseStagedUpgrade({ client, updater }) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-staged-compatibility-'));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousResourcesPath = process.resourcesPath;
  const server = http.createServer((request, response) => {
    if (request.url === '/latest.json') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(metadata));
    } else if (request.url === `/${metadata.url}`) {
      response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(metadata.size) });
      fs.createReadStream(archive).pipe(response);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  try {
    process.env.LOCALAPPDATA = temporary;
    process.resourcesPath = path.join(root, 'dist', 'staged', 'win-unpacked', 'resources');
    assert.equal(fs.existsSync(path.join(process.resourcesPath, 'tools', '7za.exe')), true, 'Staged update extractor is missing.');

    const versionRoot = path.join(temporary, 'jss-clips', 'app-versions');
    const activeDirectory = `${client.version}.app-active`;
    const rollbackVersion = client.version === '0.2.2' ? '0.2.1' : '0.4.0';
    const rollbackDirectory = `${rollbackVersion}.app-rollback`;
    for (const directory of [activeDirectory, rollbackDirectory]) {
      const directoryPath = path.join(versionRoot, directory);
      fs.mkdirSync(path.join(directoryPath, 'resources'), { recursive: true });
      fs.writeFileSync(path.join(directoryPath, 'jss clips.exe'), directory);
      fs.writeFileSync(path.join(directoryPath, 'resources', 'app.asar'), directory);
    }
    fs.writeFileSync(path.join(temporary, 'jss-clips', 'active-app.json'), JSON.stringify({
      version: client.version,
      directory: activeDirectory
    }));

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let relaunchOptions;
    let exitCode;
    const states = [];
    const stagedUpdater = updater.createStagedUpdater({
      app: {
        getPath: () => temporary,
        getVersion: () => client.version,
        relaunch: options => { relaunchOptions = options; },
        exit: code => { exitCode = code; }
      },
      feedUrl: `http://127.0.0.1:${server.address().port}`,
      onState: state => states.push(state)
    });
    assert.equal(await stagedUpdater.check(), true, `${client.version} did not discover and stage the update.`);
    assert.equal(states.at(-1)?.status, 'ready');
    const prepared = fs.readdirSync(versionRoot).filter(name => name.startsWith(`${metadata.version}.app-`));
    assert.equal(prepared.length, 1, `${client.version} did not retain exactly one prepared update.`);
    assert.equal(fs.existsSync(path.join(versionRoot, activeDirectory, 'jss clips.exe')), true, 'Active version was removed while staging.');
    assert.equal(fs.existsSync(path.join(versionRoot, rollbackDirectory, 'jss clips.exe')), true, 'Rollback version was removed while staging.');
    assert.equal(await stagedUpdater.restart(), true);
    assert.equal(exitCode, 0);
    assert.equal(relaunchOptions.execPath, path.join(versionRoot, prepared[0], 'jss clips.exe'));
    const pointer = JSON.parse(fs.readFileSync(path.join(temporary, 'jss-clips', 'active-app.json'), 'utf8'));
    assert.equal(pointer.version, metadata.version);
    assert.equal(pointer.directory, prepared[0]);
    console.log(`${client.version} completed local discovery, download, integrity validation, extraction, activation, and rollback retention.`);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = previousResourcesPath;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

(async () => {
  for (const candidate of stagedClients) await exerciseStagedUpgrade(candidate);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
