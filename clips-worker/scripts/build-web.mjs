import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = join(workerRoot, '..');
const outputRoot = join(workerRoot, 'public', 'app');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const desktopHtml = await readFile(join(projectRoot, 'src', 'index.html'), 'utf8');
const webHtml = desktopHtml
  .replace('<title>Clips</title>', '<title>Clips — browser demo</title>\n  <meta name="description" content="Explore Clips, the private automatic game recorder, in your browser.">')
  .replace('<script src="renderer.js"></script>', '<script src="web.js"></script>\n  <script src="renderer.js"></script>');

await writeFile(join(outputRoot, 'index.html'), webHtml);
await Promise.all([
  copyFile(join(projectRoot, 'src', 'styles.css'), join(outputRoot, 'styles.css')),
  copyFile(join(projectRoot, 'src', 'renderer.js'), join(outputRoot, 'renderer.js')),
  copyFile(join(projectRoot, 'src', 'changelog.json'), join(outputRoot, 'changelog.json')),
  copyFile(join(workerRoot, 'src', 'web.js'), join(outputRoot, 'web.js')),
  copyFile(join(workerRoot, 'src', 'web.css'), join(outputRoot, 'web.css'))
]);

console.log('Built browser demo in clips-worker/public/app');
