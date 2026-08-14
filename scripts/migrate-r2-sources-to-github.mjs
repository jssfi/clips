import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'clips-worker', 'package.json'));
const { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } = require('@aws-sdk/client-s3');
const repository = process.env.CLIPS_GITHUB_REPOSITORY || 'jssfi/clips';
const deleteVerified = process.argv.includes('--delete-verified');

const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(CLIPS_UPDATE_BUCKET|CLIPS_R2_ACCOUNT_ID|CLIPS_R2_ACCESS_KEY_ID|CLIPS_R2_SECRET_ACCESS_KEY)\s*=\s*(.+?)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
for (const name of ['CLIPS_UPDATE_BUCKET', 'CLIPS_R2_ACCOUNT_ID', 'CLIPS_R2_ACCESS_KEY_ID', 'CLIPS_R2_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

function githubCredential() {
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const result = spawnSync('git', ['credential', 'fill'], {
    cwd: root, encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', windowsHide: true
  });
  const password = /^password=(.+)$/m.exec(result.stdout)?.[1]?.trim();
  if (result.status !== 0 || !password) throw new Error('GitHub authentication is unavailable.');
  return password;
}

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${githubCredential()}`,
  'User-Agent': 'jss-clips-source-migrator',
  'X-GitHub-Api-Version': '2022-11-28'
};
async function githubApi(url, options = {}) {
  const response = await fetch(`https://api.github.com${url}`, { ...options, headers: { ...githubHeaders, ...options.headers } });
  if (!response.ok && response.status !== 404) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  return response;
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLIPS_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLIPS_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLIPS_R2_SECRET_ACCESS_KEY
  }
});
const bucket = process.env.CLIPS_UPDATE_BUCKET;
const objects = [];
let continuationToken;
do {
  const page = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'releases/', ContinuationToken: continuationToken }));
  objects.push(...(page.Contents || []).filter(item => /(?:^|\/)jss-clips-source-[0-9A-Za-z.-]+\.zip$/.test(item.Key || '')));
  continuationToken = page.NextContinuationToken;
} while (continuationToken);

function ensureTag(version) {
  const tag = `v${version}`;
  try { execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd: root, stdio: 'ignore' }); }
  catch {
    const nightlyCommit = /\.([0-9a-f]{7,40})$/i.exec(version)?.[1];
    const target = nightlyCommit || 'HEAD';
    execFileSync('git', ['tag', tag, target], { cwd: root, stdio: 'inherit' });
  }
  execFileSync('git', ['push', 'origin', `refs/tags/${tag}`], { cwd: root, stdio: 'inherit' });
  return tag;
}

for (const object of objects) {
  const name = path.posix.basename(object.Key);
  const version = /^jss-clips-source-(.+)\.zip$/.exec(name)?.[1];
  if (!version || !object.Size) throw new Error(`Invalid source object: ${object.Key}`);
  const tag = ensureTag(version);
  let response = await githubApi(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`);
  let release;
  if (response.status === 404) {
    response = await githubApi(`/repos/${repository}/releases`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: tag, name: `Clips ${version}`, body: 'Archived corresponding source for this distributed Clips build.', prerelease: version.includes('-'), draft: false })
    });
    release = await response.json();
    console.log(`Created GitHub release ${tag}`);
  } else release = await response.json();
  const existing = (release.assets || []).find(asset => asset.name === name);
  if (existing && Number(existing.size) !== Number(object.Size)) throw new Error(`${name} exists on GitHub with the wrong size.`);
  if (!existing) {
    const source = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
    if (!source.Body) throw new Error(`R2 returned no body for ${object.Key}`);
    const uploadBase = String(release.upload_url).replace(/\{.*$/, '');
    const upload = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { ...githubHeaders, 'Content-Type': 'application/zip', 'Content-Length': String(object.Size) },
      body: source.Body instanceof Readable ? source.Body : Readable.fromWeb(source.Body.transformToWebStream()),
      duplex: 'half'
    });
    if (!upload.ok) throw new Error(`GitHub upload failed for ${name}: HTTP ${upload.status} ${await upload.text()}`);
    const asset = await upload.json();
    if (asset.state !== 'uploaded' || Number(asset.size) !== Number(object.Size)) throw new Error(`GitHub did not verify ${name}.`);
    console.log(`Uploaded ${name} (${object.Size} bytes)`);
  } else console.log(`Verified ${name} (${object.Size} bytes)`);
}

if (deleteVerified) {
  for (const object of objects) {
    await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
    console.log(`Removed verified R2 source ${object.Key}`);
  }
} else {
  console.log(`Verified ${objects.length} source bundle(s). Re-run with --delete-verified to remove them from R2.`);
}
