const fs = require('fs');
const path = require('path');
const { loadProjectEnv, required } = require('./env');

const projectRoot = path.join(__dirname, '..');
const workerName = process.argv[2];
if (!['update-worker', 'telemetry-worker', 'clips-worker'].includes(workerName)) throw new Error('Choose update-worker, telemetry-worker, or clips-worker.');

const workerRoot = path.join(projectRoot, workerName);
const templatePath = path.join(workerRoot, 'wrangler.template.jsonc');
const targetPath = path.join(workerRoot, 'wrangler.jsonc');
const env = loadProjectEnv(projectRoot);
const template = fs.readFileSync(templatePath, 'utf8');
const variables = [...template.matchAll(/{{([A-Z0-9_]+)}}/g)].map(match => match[1]);
required(env, [...new Set(variables)]);
const rendered = template.replace(/{{([A-Z0-9_]+)}}/g, (_match, name) => JSON.stringify(String(env[name])).slice(1, -1));
JSON.parse(rendered);
fs.writeFileSync(targetPath, rendered);
console.log(`Generated ${path.relative(projectRoot, targetPath)} from .env`);
