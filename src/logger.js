const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function pruneLogText(text, cutoffMs, maxBytes) {
  const recent = String(text)
    .split(/\r?\n/)
    .filter(line => {
      if (!line) return false;
      const timestamp = Date.parse(line.slice(1, 25));
      return Number.isFinite(timestamp) && timestamp >= cutoffMs;
    });
  while (recent.length && Buffer.byteLength(`${recent.join('\n')}\n`) > maxBytes) recent.shift();
  return recent.length ? `${recent.join('\n')}\n` : '';
}

function createLogger({
  directory,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => Date.now()
}) {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'clips.log');
  let lastMaintenance = 0;

  const maintain = (force = false) => {
    try {
      const current = now();
      const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
      if (!force && current - lastMaintenance < 60_000 && size <= maxBytes) return;
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
      fs.writeFileSync(filePath, pruneLogText(existing, current - maxAgeMs, maxBytes));
      lastMaintenance = current;
    } catch {}
  };
  const write = (level, event, details) => {
    try {
      const safeDetails = details == null ? '' : ` ${JSON.stringify(details)}`;
      const line = `[${new Date(now()).toISOString()}] [${level}] ${String(event).replace(/[\r\n]+/g, ' ')}${safeDetails}\n`;
      fs.appendFileSync(filePath, line);
      maintain();
    } catch {}
  };

  maintain(true);
  return {
    filePath,
    info: (event, details) => write('INFO', event, details),
    warn: (event, details) => write('WARN', event, details),
    error: (event, details) => write('ERROR', event, details),
    capture: text => {
      for (const line of String(text).split(/\r?\n/).filter(Boolean)) write('CAPTURE', line);
    },
    maintain: () => maintain(true)
  };
}

module.exports = { createLogger, pruneLogText, DEFAULT_MAX_AGE_MS, DEFAULT_MAX_BYTES };
