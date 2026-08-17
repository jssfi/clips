import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand,
  CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand,
  PutObjectCommand, S3Client, UploadPartCommand
} from '@aws-sdk/client-s3';
import { limiter, publishMetadataPair } from './release-utils.mjs';

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

const network = limiter(Number(process.env.CLIPS_R2_UPLOAD_CONCURRENCY || 16));
const partSize = Number(process.env.CLIPS_R2_PART_SIZE || 16 * 1024 * 1024);

async function sha512File(source) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
  return hash.digest('base64');
}

async function remoteBody(key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`R2 object has no body: ${key}`);
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function remoteSha512(key) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`R2 object has no body: ${key}`);
  const hash = crypto.createHash('sha512');
  for await (const chunk of result.Body) hash.update(chunk);
  return hash.digest('base64');
}

async function verify(key, source) {
  const size = fs.statSync(source).size;
  const expectedHash = await sha512File(source);
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  if (Number(result.ContentLength) !== size) throw new Error(`R2 size mismatch for ${key}: ${result.ContentLength} != ${size}`);
  if (result.Metadata?.sha512 !== expectedHash) throw new Error(`R2 checksum metadata mismatch for ${key}.`);
  const actualHash = await remoteSha512(key);
  if (actualHash !== expectedHash) throw new Error(`R2 content checksum mismatch for ${key}.`);
}

async function upload(source, key, contentType) {
  const size = fs.statSync(source).size;
  const sha512 = await sha512File(source);
  if (size <= partSize) {
    await network(() => client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: fs.createReadStream(source), ContentLength: size, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable', Metadata: { sha512 } })));
  } else {
    const created = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable', Metadata: { sha512 } }));
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
  await verify(key, source);
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
      await verify(destinationKey, path.join(dist, name));
    }));
  }
  // Metadata is the commit point: publish it only after every referenced object is verified.
  for (const releaseChannel of channels) {
    const prefix = prefixFor(releaseChannel);
    const names = ['latest.json', 'latest.yml'];
    await publishMetadataPair(names, {
      async readPrevious(name) {
        try { return await remoteBody(`${prefix}${name}`); }
        catch (error) { if (error?.name === 'NoSuchKey') return null; throw error; }
      },
      async publishAndVerify(name) {
        const source = path.join(dist, name);
        const key = `${prefix}${name}`;
        const body = await fs.promises.readFile(source);
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: body.length, ContentType: types[path.extname(name)], CacheControl: 'no-store, max-age=0', Metadata: { sha512: crypto.createHash('sha512').update(body).digest('base64') } }));
        const live = await remoteBody(key);
        if (!live.equals(body)) throw new Error(`Published metadata verification failed for ${key}.`);
        console.log(`Published and verified ${key}`);
      },
      async restore(name, body) {
        const key = `${prefix}${name}`;
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: body.length, ContentType: types[path.extname(name)], CacheControl: 'no-store, max-age=0' }));
        if (!(await remoteBody(key)).equals(body)) throw new Error(`Metadata rollback verification failed for ${key}.`);
      },
      remove(name) {
        return client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${prefix}${name}` }));
      }
    });
  }
}
