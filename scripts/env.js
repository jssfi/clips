const fs = require('fs');
const path = require('path');

function parseEnv(text) {
  const result = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Invalid .env line: ${rawLine}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function loadProjectEnv(projectRoot = path.join(__dirname, '..')) {
  const filePath = path.join(projectRoot, '.env');
  const fileValues = fs.existsSync(filePath) ? parseEnv(fs.readFileSync(filePath, 'utf8')) : {};
  return { ...fileValues, ...process.env };
}

function required(env, names) {
  const missing = names.filter(name => !String(env[name] || '').trim());
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}. Copy .env.example to .env and configure it.`);
}

module.exports = { parseEnv, loadProjectEnv, required };
