import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.argv[2] || packageJson.version;
const repository = process.env.CLIPS_GITHUB_REPOSITORY || 'jssfi/clips';
const tag = `v${version}`;
const artifacts = [
  `jss-clips-update-${version}-x64.exe`,
  `jss-clips-update-${version}-x64.exe.blockmap`,
  `jss-clips-app-${version}-x64.zip`,
  `jss-clips-source-${version}.zip`
];
function displayVersion(value) {
  const nightly = /^(\d+\.\d+)\.\d+-nightly\.\d+\.([0-9a-f]+)$/i.exec(value);
  if (nightly) return `${nightly[1]}-${nightly[2]}`;
  const stable = /^(\d+\.\d+)\.0$/.exec(value);
  return stable ? stable[1] : value;
}

function credential() {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const result = spawnSync('git', ['credential', 'fill'], {
    cwd: root, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', windowsHide: true
  });
  if (result.status !== 0) throw new Error('GitHub authentication is unavailable. Configure GITHUB_TOKEN, GH_TOKEN, or a Git credential for github.com.');
  const password = /^password=(.+)$/m.exec(result.stdout)?.[1]?.trim();
  if (!password) throw new Error('The configured GitHub credential did not provide an access token.');
  return password;
}

const token = credential();
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'jss-clips-local-publisher',
  'X-GitHub-Api-Version': '2022-11-28'
};

async function api(url, options = {}) {
  const response = await fetch(`https://api.github.com${url}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok && response.status !== 404) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response;
}

for (const name of artifacts) {
  if (!fs.existsSync(path.join(dist, name))) throw new Error(`Missing release artifact: dist\\${name}`);
}

let tagExists = true;
try { execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd: root, stdio: 'ignore' }); }
catch { tagExists = false; }
if (!tagExists) execFileSync('git', ['tag', tag, 'HEAD'], { cwd: root, stdio: 'inherit' });
execFileSync('git', ['push', 'origin', `refs/tags/${tag}`], { cwd: root, stdio: 'inherit' });

let response = await api(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`);
let release;
if (response.status === 404) {
  const changelog = JSON.parse(fs.readFileSync(path.join(root, 'src', 'changelog.json'), 'utf8'));
  const entry = changelog.find(item => item.version && version.includes(item.version.replace(/^\d+\.\d+-/, '')) ) || changelog[0];
  response = await api(`/repos/${repository}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: `Clips ${entry?.version || displayVersion(version)}`,
      body: [`## ${entry?.title || 'Clips release'}`, '', ...(entry?.changes || []).map(change => `- ${change}`)].join('\n'),
      prerelease: version.includes('-'),
      draft: false
    })
  });
  release = await response.json();
  console.log(`Created GitHub release ${tag}`);
} else {
  release = await response.json();
  console.log(`Using existing GitHub release ${tag}`);
}
const expectedName = `Clips ${displayVersion(version)}`;
if (release.name !== expectedName) {
  const updated = await api(`/repos/${repository}/releases/${release.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: expectedName })
  });
  release = await updated.json();
  console.log(`Named GitHub release ${expectedName}`);
}

const existing = new Map((release.assets || []).map(asset => [asset.name, asset]));
const uploadBase = String(release.upload_url).replace(/\{.*$/, '');
for (const name of artifacts) {
  const file = path.join(dist, name);
  const size = fs.statSync(file).size;
  const current = existing.get(name);
  if (current) {
    if (Number(current.size) !== size) throw new Error(`GitHub asset ${name} exists with the wrong size.`);
    console.log(`Verified GitHub asset ${name} (${size} bytes)`);
    continue;
  }
  const upload = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    body: fs.createReadStream(file), duplex: 'half'
  });
  if (!upload.ok) throw new Error(`GitHub upload failed for ${name}: HTTP ${upload.status} ${await upload.text()}`);
  const asset = await upload.json();
  if (Number(asset.size) !== size || asset.state !== 'uploaded') throw new Error(`GitHub did not finish uploading ${name}.`);
  console.log(`Uploaded GitHub asset ${name} (${size} bytes)`);
}

console.log(`Published and verified https://github.com/${repository}/releases/tag/${tag}`);
