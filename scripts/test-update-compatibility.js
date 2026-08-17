const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'latest.json'), 'utf8'));
const clients = [
  { tag: 'v0.4.0', version: '0.4.0', channel: 'stable' },
  { tag: 'v0.4.1-nightly.33.4ce5c2d0', version: '0.4.1-nightly.33.4ce5c2d0', channel: 'nightly' },
  { tag: 'v0.5.0-nightly.1.349ce990', version: '0.5.0-nightly.1.349ce990', channel: 'nightly' }
];

function gitFile(tag, file) {
  return execFileSync('git', ['show', `${tag}:${file}`], { cwd: root });
}

for (const client of clients) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-compatibility-'));
  try {
    for (const directory of ['src', 'scripts']) fs.mkdirSync(path.join(temporary, directory), { recursive: true });
    for (const file of ['src/updater.js', 'src/update-signing-public.pem', 'scripts/update-signature.js']) {
      fs.writeFileSync(path.join(temporary, file), gitFile(client.tag, file));
    }
    const updater = require(path.join(temporary, 'src', 'updater.js'));
    const accepted = updater.authenticateMetadata(metadata);
    assert.equal(accepted.version, metadata.version);
    assert.equal(updater.compareVersions(metadata.version, client.version) > 0, true);
    console.log(`${client.channel} client ${client.version} accepts update ${metadata.version}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
