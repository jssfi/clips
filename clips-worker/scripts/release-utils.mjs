function limiter(maximum) {
  let active = 0;
  const waiting = [];
  const run = () => {
    while (active < maximum && waiting.length) {
      const { task, resolve, reject } = waiting.shift();
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active -= 1; run(); });
    }
  };
  return task => new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); run(); });
}

const VERSIONED_ARTIFACTS = [
  /^jss-clips-(?:update|setup|portable)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(?:x64|arm64)\.(?:exe|exe\.blockmap)$/,
  /^jss-clips-app-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-x64\.zip$/,
  /^jss-clips-source-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.zip$/
];

function artifactVersion(key) {
  const name = String(key || '').split('/').at(-1);
  return VERSIONED_ARTIFACTS.map(pattern => pattern.exec(name)?.[1]).find(Boolean) || null;
}

function parseReleaseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) return null;
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') || []
  };
}

function compareReleaseVersions(left, right) {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : (a.prerelease.length ? -1 : 1);
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    if (a.prerelease[index] === b.prerelease[index]) continue;
    const aNumeric = /^\d+$/.test(a.prerelease[index]);
    const bNumeric = /^\d+$/.test(b.prerelease[index]);
    if (aNumeric && bNumeric) return Number(a.prerelease[index]) - Number(b.prerelease[index]);
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.prerelease[index].localeCompare(b.prerelease[index]);
  }
  return 0;
}

function releaseRetentionPlan(objects, retainedVersionCount = 3) {
  if (!Number.isSafeInteger(retainedVersionCount) || retainedVersionCount < 1) {
    throw new Error('retainedVersionCount must be a positive integer.');
  }
  const objectsByVersion = new Map();
  for (const object of objects) {
    const version = artifactVersion(object.Key);
    if (!version) continue;
    if (!objectsByVersion.has(version)) objectsByVersion.set(version, []);
    objectsByVersion.get(version).push(object);
  }
  const versions = [...objectsByVersion.keys()].sort((a, b) => compareReleaseVersions(b, a));
  const retainedVersions = versions.slice(0, retainedVersionCount);
  const deletedVersions = versions.slice(retainedVersionCount);
  return {
    retainedVersions,
    deletedVersions,
    deleteObjects: deletedVersions.flatMap(version => objectsByVersion.get(version))
  };
}

async function publishMetadataPair(names, operations) {
  const previous = new Map();
  for (const name of names) {
    const value = await operations.readPrevious(name);
    if (value !== null) previous.set(name, value);
  }
  const published = [];
  try {
    for (const name of names) {
      await operations.publishAndVerify(name);
      published.push(name);
    }
  } catch (error) {
    const rollback = await Promise.allSettled(published.map(name => previous.has(name)
      ? operations.restore(name, previous.get(name))
      : operations.remove(name)));
    const failed = rollback.filter(result => result.status === 'rejected');
    if (failed.length) throw new AggregateError([error, ...failed.map(result => result.reason)], 'Metadata publication and rollback both failed.');
    throw new Error(`Metadata publication rolled back after failure: ${error.message}`);
  }
}

export { artifactVersion, compareReleaseVersions, limiter, publishMetadataPair, releaseRetentionPlan };
