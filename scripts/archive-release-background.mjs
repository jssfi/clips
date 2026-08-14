import { spawnSync } from 'node:child_process';
import path from 'node:path';

const [dist, bucket, channel, version] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '..');
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(path.join(root, 'scripts', 'publish-github-release.mjs'), [version]);
run(path.join(root, 'clips-worker', 'scripts', 'publish-r2.mjs'), [dist, bucket, channel, version, 'cleanup']);
console.log(`GitHub archival and R2 cleanup completed for Clips ${version}.`);
