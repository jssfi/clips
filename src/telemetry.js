const fs = require('fs');
const crypto = require('crypto');

const VALID_MODES = new Set(['diagnostics', 'version', 'off']);
const MAX_LOG_BYTES = 48 * 1024;

function configuredEndpoint() {
  try {
    const value = String(require('./release-config.json').telemetryUrl || '').trim();
    return new URL(value).protocol === 'https:' ? value.replace(/\/+$/, '') : '';
  } catch { return ''; }
}

function sanitizeLog(text, replacements = []) {
  let result = String(text || '');
  for (const value of replacements.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(String(value)).join('<redacted-path>');
  }
  result = result.replace(/[A-Z]:\\[^"\r\n}]*/gi, '<redacted-path>');
  const bytes = Buffer.from(result);
  return bytes.length <= MAX_LOG_BYTES ? result : bytes.subarray(bytes.length - MAX_LOG_BYTES).toString('utf8');
}

function loadInstallationId(filePath) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.installationId)) return saved.installationId;
  } catch {}
  const installationId = crypto.randomUUID();
  fs.writeFileSync(filePath, `${JSON.stringify({ installationId }, null, 2)}\n`);
  return installationId;
}

function createTelemetry({ endpoint, mode, installationId, appVersion, runtimeVersion, system, logger, redact = [], fetchImpl = global.fetch }) {
  const enabled = endpoint && VALID_MODES.has(mode) && mode !== 'off';
  let lastErrorSignature = '';
  let lastErrorTime = 0;
  async function send(event, error) {
    if (!enabled) return false;
    const payload = { schemaVersion: 1, installationId, mode, event, timestamp: new Date().toISOString(), appVersion, runtimeVersion };
    if (mode === 'diagnostics') payload.system = system;
    if (mode === 'diagnostics' && event === 'error') {
      let log = '';
      try { log = sanitizeLog(fs.readFileSync(logger.filePath, 'utf8'), redact); } catch {}
      payload.error = { message: sanitizeLog(String(error?.message || error || 'Unknown error'), redact).slice(0, 1000), log };
    }
    try {
      const response = await fetchImpl(`${endpoint}/v1/events`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (sendError) {
      logger.warn('telemetry send failed', { message: sendError.message });
      return false;
    }
  }
  const reportError = error => {
    if (mode !== 'diagnostics') return Promise.resolve(false);
    const signature = String(error?.message || error || 'Unknown error');
    const now = Date.now();
    if (signature === lastErrorSignature && now - lastErrorTime < 10 * 60 * 1000) return Promise.resolve(false);
    lastErrorSignature = signature;
    lastErrorTime = now;
    return send('error', error);
  };
  return { enabled: !!enabled, sendStartup: () => send('startup'), reportError };
}

module.exports = { configuredEndpoint, sanitizeLog, loadInstallationId, createTelemetry, VALID_MODES, MAX_LOG_BYTES };
