const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const dist = path.join(root, 'dist');
const cache = path.join(dist, 'source-cache');
const staging = path.join(dist, 'source-bundle');
const archive = path.join(dist, `jss-clips-source-${version}.zip`);
const sevenZip = path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const sources = [
  { name: 'obs-studio-31.1.2.zip', url: 'https://github.com/obsproject/obs-studio/archive/refs/tags/31.1.2.zip', sha256: 'cd9b04680137486ba429a6ced50ba1868a6d9ec49503d524c053c21ea8b64062' },
  { name: 'mpv-dd5d17d328.zip', url: 'https://github.com/mpv-player/mpv/archive/dd5d17d328.zip', sha256: 'e82426ff14b1c05705f9e16889bba17f28e578b6c5a0b32ed03b0f9ee050c72f' },
  { name: 'ffmpeg-f944afd04.zip', url: 'https://github.com/FFmpeg/FFmpeg/archive/f944afd04.zip', sha256: 'b3ab31defa7f5204965bcd9515fc07ddfedfc35bf81631bbdc62824f6374ed3e' },
  { name: 'mpv-winbuild-cmake-cd1edc1.zip', url: 'https://github.com/shinchiro/mpv-winbuild-cmake/archive/cd1edc1.zip', sha256: '770882870fd2d66411150947777147e8c7ebaa5b8b6e980b7643b79b7bc4a989' }
];

const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function download(source, target) {
  if (fs.existsSync(target) && hash(target) === source.sha256) return;
  const response = await fetch(source.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Could not download ${source.url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw new Error(`Checksum mismatch for ${source.name}`);
  fs.writeFileSync(target, bytes);
}

(async () => {
  fs.mkdirSync(cache, { recursive: true });
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, 'upstream'), { recursive: true });
  for (const source of sources) {
    const cached = path.join(cache, source.name);
    await download(source, cached);
    fs.copyFileSync(cached, path.join(staging, 'upstream', source.name));
  }
  execFileSync('git', ['archive', '--format=zip', `--output=${path.join(staging, 'clips-source.zip')}`, 'HEAD'], { cwd: root, stdio: 'inherit' });
  const manifest = [
    '# Clips corresponding source bundle', '',
    `This bundle accompanies Clips ${version}.`, '',
    '`clips-source.zip` is the complete repository snapshot used for this release, including the GPL native hosts and build scripts.',
    '`upstream/` contains the exact OBS Studio, MPV/libmpv, FFmpeg, and mpv-winbuild-cmake source snapshots identified in the shipped third-party notices.',
    'The pinned mpv-winbuild-cmake snapshot records the dependency revisions and build configuration used by the distributed MPV and FFmpeg binaries.', '',
    ...sources.map(source => `- ${source.name}: SHA-256 ${source.sha256}`), ''
  ].join('\n');
  fs.writeFileSync(path.join(staging, 'README.md'), manifest);
  fs.rmSync(archive, { force: true });
  execFileSync(sevenZip, ['a', '-tzip', '-mx=6', archive, '.\\*'], { cwd: staging, stdio: 'inherit' });
  console.log(`Built ${path.relative(root, archive)} (${fs.statSync(archive).size} bytes).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
