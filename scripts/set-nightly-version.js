const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const packagePath = path.join(projectRoot, 'package.json');
const lockPath = path.join(projectRoot, 'package-lock.json');
const changelogPath = path.join(projectRoot, 'src', 'changelog.json');
const base = String(process.argv[2] || '').trim();
if (!/^\d+\.\d+$/.test(base)) throw new Error('Usage: npm run version:nightly -- <major.minor>');

const git = (...args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Commit application changes before generating the nightly version.');
const hash = git('rev-parse', '--short=8', 'HEAD').toLowerCase();
const commitCount = Number(git('rev-list', '--count', 'HEAD'));
if (!Number.isSafeInteger(commitCount) || commitCount < 1) throw new Error('Could not determine the Git commit count.');

const internalVersion = `${base}.1-nightly.${commitCount}.${hash}`;
const displayVersion = `${base}-${hash}`;
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
if (!changelog[0] || changelog[0].version !== 'next') {
  throw new Error('The first changelog entry must use "version": "next" before generating a nightly.');
}

packageJson.version = internalVersion;
packageLock.version = internalVersion;
packageLock.packages[''].version = internalVersion;
changelog[0].version = displayVersion;
for (const [target, value] of [[packagePath, packageJson], [lockPath, packageLock], [changelogPath, changelog]]) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}
console.log(`Nightly ${displayVersion} (${internalVersion}) identifies commit ${hash}.`);
