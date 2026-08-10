const fs = require('fs');
const path = require('path');
const { loadProjectEnv } = require('./env');
const { signMetadata } = require('./update-signature');

const root = path.join(__dirname, '..');
const env = loadProjectEnv(root);
const metadataPath = path.resolve(process.argv[2] || path.join(root, 'dist', 'latest.json'));
const privatePath = path.resolve(env.CLIPS_UPDATE_SIGNING_KEY || path.join(root, '.clips-private', 'update-signing-private.pem'));
if (!fs.existsSync(privatePath)) throw new Error(`Update signing key not found: ${privatePath}`);
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
metadata.signature = signMetadata(metadata, fs.readFileSync(privatePath));
fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Signed ${path.relative(root, metadataPath)}.`);
