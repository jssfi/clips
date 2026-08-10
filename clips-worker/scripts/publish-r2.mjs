import fs from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const [dist, bucket, channel, version] = process.argv.slice(2);
for (const name of ['CLIPS_R2_ACCOUNT_ID', 'CLIPS_R2_ACCESS_KEY_ID', 'CLIPS_R2_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`${name} is required. Use bucket-scoped R2 credentials.`);
}
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.CLIPS_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLIPS_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLIPS_R2_SECRET_ACCESS_KEY
  }
});
const artifactNames = [
  `jss-clips-update-${version}-x64.exe`,
  `jss-clips-update-${version}-x64.exe.blockmap`,
  `jss-clips-app-${version}-x64.zip`,
  `jss-clips-source-${version}.zip`
];
const files = [...artifactNames, 'latest.yml', 'latest.json'];
const types = { '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream', '.zip': 'application/zip', '.yml': 'text/yaml; charset=utf-8', '.json': 'application/json; charset=utf-8' };

async function textIfPresent(key) {
  try { return await (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body.transformToString(); }
  catch (error) { if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return ''; throw error; }
}

for (const releaseChannel of channel === 'both' ? ['nightly', 'stable'] : [channel]) {
  const prefix = releaseChannel === 'stable' ? 'releases/stable/' : 'releases/';
  const oldNames = new Set();
  const oldYaml = await textIfPresent(`${prefix}latest.yml`);
  for (const match of oldYaml.matchAll(/(?:-\s+url:|path:)\s+([^\s]+)/g)) {
    const name = path.basename(match[1]);
    if (/^jss-clips-(?:update|setup)-[0-9A-Za-z.-]+-(?:x64|arm64)\.exe$/.test(name)) { oldNames.add(name); oldNames.add(`${name}.blockmap`); }
  }
  const oldJson = await textIfPresent(`${prefix}latest.json`);
  if (oldJson) {
    const name = path.basename(JSON.parse(oldJson).url || '');
    if (/^jss-clips-app-[0-9A-Za-z.-]+-x64\.zip$/.test(name)) oldNames.add(name);
  }
  for (const name of files) {
    const source = path.join(dist, name);
    if (!fs.statSync(source).isFile()) throw new Error(`Missing release artifact: ${source}`);
    const extension = name.endsWith('.exe.blockmap') ? '.blockmap' : path.extname(name);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}${name}`, Body: fs.createReadStream(source), ContentType: types[extension], CacheControl: name.startsWith('latest.') ? 'no-store, max-age=0' : 'public, max-age=31536000, immutable' }));
    console.log(`Uploaded ${prefix}${name}`);
  }
  // Source bundles are retained permanently to honor the source offer for old releases.
  for (const name of oldNames) if (!artifactNames.includes(name) && !name.startsWith('jss-clips-source-')) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${prefix}${name}` }));
    console.log(`Removed ${prefix}${name}`);
  }
}
