const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const privatePath = path.resolve(process.argv[2] || path.join(root, '.clips-private', 'update-signing-private.pem'));
const publicPath = path.join(root, 'src', 'update-signing-public.pem');
if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) throw new Error('Refusing to overwrite an existing update signing key.');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(privatePath), { recursive: true });
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
console.log(`Generated update signing keys. Keep private key offline: ${privatePath}`);
