const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('node:assert/strict');
const { createStagedUpdater } = require('../src/updater');

async function main() {
  const projectRoot = path.join(__dirname, '..');
  const metadataPath = path.join(projectRoot, 'dist', 'latest.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const archive = path.join(projectRoot, 'dist', metadata.url);
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clips-update-test-'));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousResourcesPath = process.resourcesPath;
  const originalRename = fs.promises.rename;
  const server = http.createServer((request, response) => {
    if (request.url === '/latest.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      fs.createReadStream(metadataPath).pipe(response);
      return;
    }
    if (request.url === `/${metadata.url}`) {
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(fs.statSync(archive).size)
      });
      fs.createReadStream(archive).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end();
  });

  try {
    process.env.LOCALAPPDATA = temporaryRoot;
    process.resourcesPath = path.join(projectRoot, 'dist', 'staged', 'win-unpacked', 'resources');
    fs.promises.rename = async () => {
      throw Object.assign(new Error('Updater must not rename prepared application directories.'), {
        code: 'EPERM'
      });
    };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const states = [];
    let relaunchOptions = null;
    let exitCode = null;
    const updater = createStagedUpdater({
      app: {
        getPath: () => temporaryRoot,
        getVersion: () => '0.1.11',
        relaunch: options => { relaunchOptions = options; },
        exit: code => { exitCode = code; }
      },
      feedUrl: `http://127.0.0.1:${server.address().port}`,
      onState: state => states.push(state)
    });
    assert.equal(await updater.check(), true);
    assert.equal(states.at(-1).status, 'ready');
    assert.ok(states.some(state => state.status === 'preparing'));
    const versionRoot = path.join(temporaryRoot, 'jss-clips', 'app-versions');
    const versionDirectories = fs.readdirSync(versionRoot)
      .filter(name => name.startsWith(`${metadata.version}.app-`));
    assert.equal(versionDirectories.length, 1);
    const preparedExecutable = path.join(versionRoot, versionDirectories[0], 'jss clips.exe');
    assert.ok(fs.existsSync(preparedExecutable));
    assert.equal(await updater.restart(), true);
    assert.equal(exitCode, 0);
    assert.equal(relaunchOptions.execPath, preparedExecutable);
    assert.equal(relaunchOptions.args.includes('--hidden'), false);
    const active = JSON.parse(fs.readFileSync(
      path.join(temporaryRoot, 'jss-clips', 'active-app.json'), 'utf8'
    ));
    assert.equal(active.version, metadata.version);
    assert.equal(active.directory, versionDirectories[0]);
    console.log(`Staged updater prepared Clips ${metadata.version} successfully.`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    if (previousResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = previousResourcesPath;
    fs.promises.rename = originalRename;
    await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
