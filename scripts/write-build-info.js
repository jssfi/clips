const fs = require('fs');
const path = require('path');
const { loadProjectEnv } = require('./env');

const target = path.join(__dirname, '..', 'src', 'build-info.json');
const releaseConfigTarget = path.join(__dirname, '..', 'src', 'release-config.json');
const buildInfo = {
  buildTime: new Date().toISOString()
};

fs.writeFileSync(target, `${JSON.stringify(buildInfo, null, 2)}\n`);
console.log(`Build time: ${buildInfo.buildTime}`);

const env = loadProjectEnv();
const baseUrl = String(env.CLIPS_BASE_URL || '').trim().replace(/\/+$/, '');
const updateUrl = String(env.CLIPS_UPDATE_URL || (baseUrl && `${baseUrl}${env.CLIPS_UPDATE_PATH || '/cdn'}`)).trim();
const telemetryUrl = String(env.CLIPS_TELEMETRY_URL || (baseUrl && `${baseUrl}${env.CLIPS_TELEMETRY_PATH || '/telemetry'}`)).trim();
if (telemetryUrl) {
  const releaseConfig = { updateUrl, telemetryUrl };
  for (const [name, value] of Object.entries(releaseConfig)) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
    releaseConfig[name] = parsed.href.replace(/\/$/, '');
  }
  fs.writeFileSync(releaseConfigTarget, `${JSON.stringify(releaseConfig, null, 2)}\n`);
  console.log('Telemetry: enabled for this build');
} else {
  fs.rmSync(releaseConfigTarget, { force: true });
  console.log('Telemetry: disabled (no private release configuration)');
}
