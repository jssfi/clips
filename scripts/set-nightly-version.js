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

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const changelog = JSON.parse(fs.readFileSync(changelogPath, 'utf8'));
if (!changelog[0] || changelog[0].version !== 'next') {
  throw new Error('The first changelog entry must use "version": "next" before generating a nightly.');
}
const previousSequences = changelog
  .map(entry => new RegExp(`^${base.replace('.', '\\.')}\\-nightly\\.(\\d+)$`).exec(String(entry.version || '')))
  .filter(Boolean)
  .map(match => Number(match[1]));
const nightlySequence = Math.max(0, ...previousSequences) + 1;
// GitHub orders prerelease tags lexically rather than comparing numeric SemVer
// identifiers. Keep the sequence in a fixed-width alphanumeric identifier so
// nightly 19 remains above nightly 9 without using invalid leading-zero numbers.
const sortableSequence = `n${String(nightlySequence).padStart(6, '0')}`;
const internalVersion = `${base}.0-nightly.${sortableSequence}.${hash}`;
const displayVersion = `${base}-nightly.${nightlySequence}`;

packageJson.version = internalVersion;
packageLock.version = internalVersion;
packageLock.packages[''].version = internalVersion;
changelog[0].version = displayVersion;
for (const [target, value] of [[packagePath, packageJson], [lockPath, packageLock], [changelogPath, changelog]]) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}
console.log(`Nightly ${displayVersion} (${internalVersion}) identifies commit ${hash}.`);
