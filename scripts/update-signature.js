const crypto = require('crypto');

const SIGNED_FIELDS = ['version', 'url', 'sha512', 'size', 'releaseDate'];

function signedPayload(metadata) {
  const value = {};
  for (const field of SIGNED_FIELDS) value[field] = metadata[field];
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function signMetadata(metadata, privateKey) {
  return crypto.sign(null, signedPayload(metadata), privateKey).toString('base64');
}

function verifyMetadata(metadata, publicKey) {
  if (typeof metadata?.signature !== 'string' || !metadata.signature) return false;
  try {
    return crypto.verify(null, signedPayload(metadata), publicKey, Buffer.from(metadata.signature, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { signedPayload, signMetadata, verifyMetadata };
