const fs = require('fs');
const path = require('path');
const { loadProjectEnv } = require('./env');

const target = path.join(__dirname, '..', 'src', 'build-info.json');
const releaseConfigTarget = path.join(__dirname, '..', 'src', 'release-config.json');
function releaseConfigFromEnv(env) {
  const baseUrl = String(env.CLIPS_BASE_URL || '').trim().replace(/\/+$/, '');
  const values = {
    updateUrl: String(env.CLIPS_UPDATE_URL || (baseUrl && `${baseUrl}${env.CLIPS_UPDATE_PATH || '/cdn'}`)).trim(),
    telemetryUrl: String(env.CLIPS_TELEMETRY_URL || (baseUrl && `${baseUrl}${env.CLIPS_TELEMETRY_PATH || '/telemetry'}`)).trim()
  };
  const releaseConfig = {};
  for (const [name, value] of Object.entries(values)) {
    if (!value) continue;
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
    releaseConfig[name] = parsed.href.replace(/\/$/, '');
  }
  return releaseConfig;
}

function writeBuildInfo(env = loadProjectEnv()) {
  const buildInfo = { buildTime: new Date().toISOString() };
  fs.writeFileSync(target, `${JSON.stringify(buildInfo, null, 2)}\n`);
  console.log(`Build time: ${buildInfo.buildTime}`);
  const releaseConfig = releaseConfigFromEnv(env);
  if (Object.keys(releaseConfig).length) {
  fs.writeFileSync(releaseConfigTarget, `${JSON.stringify(releaseConfig, null, 2)}\n`);
    console.log(`Release configuration: ${Object.keys(releaseConfig).join(', ')}`);
  } else {
    fs.rmSync(releaseConfigTarget, { force: true });
    console.log('Release configuration: disabled');
  }
}

if (require.main === module) writeBuildInfo();

module.exports = { releaseConfigFromEnv, writeBuildInfo };
