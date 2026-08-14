import fs from 'node:fs';
import path from 'node:path';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand,
  CreateMultipartUploadCommand, DeleteObjectCommand, HeadObjectCommand,
  PutObjectCommand, S3Client, UploadPartCommand
} from '@aws-sdk/client-s3';

const [dist, bucket, channel, version, mode = 'publish'] = process.argv.slice(2);
for (const name of ['CLIPS_R2_ACCOUNT_ID', 'CLIPS_R2_ACCESS_KEY_ID', 'CLIPS_R2_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`${name} is required. Use bucket-scoped R2 credentials.`);
}
const client = new S3Client({
  region: 'auto', endpoint: `https://${process.env.CLIPS_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.CLIPS_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLIPS_R2_SECRET_ACCESS_KEY }
});
const artifactNames = [
  `jss-clips-update-${version}-x64.exe`, `jss-clips-update-${version}-x64.exe.blockmap`,
  `jss-clips-app-${version}-x64.zip`, `jss-clips-source-${version}.zip`
];
if (!version.includes('-')) artifactNames.push(`jss-clips-setup-${version}-x64.exe`);
const channels = channel === 'both' ? ['nightly', 'stable'] : [channel];
const prefixFor = value => value === 'stable' ? 'releases/stable/' : 'releases/';
const types = { '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream', '.zip': 'application/zip', '.yml': 'text/yaml; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function limiter(maximum) {
  let active = 0;
  const waiting = [];
  const run = () => {
    while (active < maximum && waiting.length) {
      const { task, resolve, reject } = waiting.shift(); active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; run(); });
    }
  };
  return task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); run(); });
}
const network = limiter(Number(process.env.CLIPS_R2_UPLOAD_CONCURRENCY || 16));
const partSize = Number(process.env.CLIPS_R2_PART_SIZE || 16 * 1024 * 1024);

async function verify(key, size) {
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (Number(result.ContentLength) !== size) throw new Error(`R2 size mismatch for ${key}: ${result.ContentLength} != ${size}`);
}

async function upload(source, key, contentType) {
  const size = fs.statSync(source).size;
  if (size <= partSize) {
    await network(() => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fs.createReadStream(source), ContentLength: size, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' })));
  } else {
    const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }));
    try {
      const count = Math.ceil(size / partSize);
      const parts = await Promise.all(Array.from({ length: count }, (_, index) => network(async () => {
        const start = index * partSize;
        const length = Math.min(partSize, size - start);
        const result = await client.send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId, PartNumber: index + 1, Body: fs.createReadStream(source, { start, end: start + length - 1 }), ContentLength: length }));
        return { ETag: result.ETag, PartNumber: index + 1 };
      })));
      await client.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId, MultipartUpload: { Parts: parts } }));
    } catch (error) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: created.UploadId })).catch(() => {});
      throw error;
    }
  }
  await verify(key, size);
  console.log(`Uploaded and verified ${key} (${size} bytes)`);
}

if (mode === 'cleanup') {
  await Promise.all(channels.flatMap(releaseChannel => artifactNames.map(name => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${prefixFor(releaseChannel)}${name}` })) )));
  console.log(`Removed temporary R2 artifacts for ${version}; GitHub is now the fallback.`);
} else {
  const primary = channels[0];
  const primaryPrefix = prefixFor(primary);
  await Promise.all(artifactNames.map(async name => {
    const extension = name.endsWith('.exe.blockmap') ? '.blockmap' : path.extname(name);
    await upload(path.join(dist, name), `${primaryPrefix}${name}`, types[extension]);
  }));
  for (const releaseChannel of channels.slice(1)) {
    const prefix = prefixFor(releaseChannel);
    await Promise.all(artifactNames.map(async name => {
      const sourceKey = `${primaryPrefix}${name}`;
      const destinationKey = `${prefix}${name}`;
      await network(() => client.send(new CopyObjectCommand({ Bucket: bucket, Key: destinationKey, CopySource: `${bucket}/${sourceKey}` })));
      await verify(destinationKey, fs.statSync(path.join(dist, name)).size);
    }));
  }
  // Metadata is the commit point: publish it only after every referenced object is verified.
  for (const releaseChannel of channels) {
    const prefix = prefixFor(releaseChannel);
    await Promise.all(['latest.yml', 'latest.json'].map(async name => {
      const source = path.join(dist, name);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: `${prefix}${name}`, Body: fs.createReadStream(source), ContentLength: fs.statSync(source).size, ContentType: types[path.extname(name)], CacheControl: 'no-store, max-age=0' }));
      console.log(`Published ${prefix}${name}`);
    }));
  }
}
