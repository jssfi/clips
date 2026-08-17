import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LEGACY_NIGHTLY = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d+)\.([0-9a-f]{7,40})$/i;
const SORTABLE_NIGHTLY = /^v(\d+)\.(\d+)\.(\d+)-nightly\.n(\d{6})\.([0-9a-f]{7,40})$/i;

function migratedTag(tag) {
  const match = LEGACY_NIGHTLY.exec(String(tag));
  if (!match) return null;
  const sequence = Number(match[4]);
  if (!Number.isSafeInteger(sequence) || sequence > 999999) {
    throw new Error(`Nightly sequence cannot be represented in six digits: ${tag}`);
  }
  return `v${match[1]}.${match[2]}.${match[3]}-nightly.n${String(sequence).padStart(6, '0')}.${match[5]}`;
}

function releaseFingerprint(release) {
  return {
    id: release.id,
    name: release.name,
    body: release.body,
    draft: release.draft,
    prerelease: release.prerelease,
    assets: (release.assets || []).map(asset => ({
      id: asset.id,
      name: asset.name,
      label: asset.label,
      size: asset.size,
      state: asset.state,
      digest: asset.digest || null
    })).sort((left, right) => left.id - right.id)
  };
}

function buildPlan(releases) {
  const existingReleaseTags = new Map(releases.map(release => [release.tag_name, release]));
  const destinations = new Set();
  const plan = [];
  for (const release of releases) {
    const newTag = migratedTag(release.tag_name);
    if (!newTag) continue;
    if (!release.prerelease) throw new Error(`Matching release is not marked as a prerelease: ${release.tag_name}`);
    if (destinations.has(newTag)) throw new Error(`More than one release maps to ${newTag}.`);
    destinations.add(newTag);
    const collision = existingReleaseTags.get(newTag);
    if (collision && collision.id !== release.id) {
      throw new Error(`Destination ${newTag} already belongs to release ${collision.id}.`);
    }
    plan.push({ release, oldTag: release.tag_name, newTag, fingerprint: releaseFingerprint(release) });
  }
  return plan.sort((left, right) => left.oldTag.localeCompare(right.oldTag));
}

function assertSortableTags(tags) {
  const groups = new Map();
  for (const tag of tags) {
    const match = SORTABLE_NIGHTLY.exec(tag);
    if (!match) continue;
    const key = `${match[1]}.${match[2]}.${match[3]}`;
    const group = groups.get(key) || [];
    group.push({ tag, sequence: Number(match[4]) });
    groups.set(key, group);
  }
  for (const [version, group] of groups) {
    const lexical = [...group].sort((left, right) => right.tag.localeCompare(left.tag)).map(item => item.sequence);
    const numeric = [...group].sort((left, right) => right.sequence - left.sequence).map(item => item.sequence);
    if (lexical.some((sequence, index) => sequence !== numeric[index])) {
      throw new Error(`Nightly tags for ${version} do not sort newest-first lexically.`);
    }
  }
}

function parseArguments(argv) {
  const options = { apply: false, verifyOnly: false, json: false, repository: process.env.CLIPS_GITHUB_REPOSITORY || 'jssfi/clips' };
  for (const argument of argv) {
    if (argument === '--apply') options.apply = true;
    else if (argument === '--verify-only') options.verifyOnly = true;
    else if (argument === '--json') options.json = true;
    else if (argument.startsWith('--repository=')) options.repository = argument.slice('--repository='.length);
    else if (argument.startsWith('--confirm-retag=')) options.confirm = argument.slice('--confirm-retag='.length);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(options.repository)) throw new Error(`Invalid GitHub repository: ${options.repository}`);
  if (options.apply && options.verifyOnly) throw new Error('--apply and --verify-only cannot be combined.');
  if (options.apply && options.confirm !== options.repository) {
    throw new Error(`Mutation requires --confirm-retag=${options.repository}`);
  }
  return options;
}

function credential(required) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) return token;
  const result = spawnSync('git', ['credential', 'fill'], {
    encoding: 'utf8', input: 'protocol=https\nhost=github.com\n\n', windowsHide: true
  });
  const password = /^password=(.+)$/m.exec(result.stdout)?.[1]?.trim();
  if (result.status === 0 && password) return password;
  if (required) {
    throw new Error('GitHub authentication is unavailable. Configure GITHUB_TOKEN, GH_TOKEN, or a Git credential.');
  }
  return '';
}

function createClient(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jss-clips-nightly-tag-migrator',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return async function api(url, options = {}, allowed = []) {
    const response = await fetch(`https://api.github.com${url}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });
    if (!response.ok && !allowed.includes(response.status)) {
      throw new Error(`GitHub API ${response.status} for ${options.method || 'GET'} ${url}: ${await response.text()}`);
    }
    return response;
  };
}

async function listReleases(api, repository) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await api(`/repos/${repository}/releases?per_page=100&page=${page}`);
    const batch = await response.json();
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}

async function getRef(api, repository, tag, required = true) {
  const response = await api(`/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, {}, [404]);
  if (response.status === 404) {
    if (required) throw new Error(`Git tag does not exist: ${tag}`);
    return null;
  }
  return response.json();
}

async function mapConcurrent(items, limit, operation) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function preflight(api, repository, plan) {
  await mapConcurrent(plan, 8, async item => {
    item.oldRef = await getRef(api, repository, item.oldTag);
    item.newRef = await getRef(api, repository, item.newTag, false);
    if (item.newRef && item.newRef.object.sha !== item.oldRef.object.sha) {
      throw new Error(`Destination ${item.newTag} points to ${item.newRef.object.sha}, not ${item.oldRef.object.sha}.`);
    }
  });
}

async function applyPlan(api, repository, plan, log) {
  for (const item of plan) {
    if (!item.newRef) {
      await api(`/repos/${repository}/git/refs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: `refs/tags/${item.newTag}`, sha: item.oldRef.object.sha })
      });
      log(`Created ${item.newTag} at ${item.oldRef.object.sha}.`);
    }
    await api(`/repos/${repository}/releases/${item.release.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: item.newTag })
    });
    log(`Retagged release ${item.release.id}: ${item.oldTag} -> ${item.newTag}.`);
  }
}

async function verifyPlan(api, repository, plan) {
  const releases = await listReleases(api, repository);
  const byId = new Map(releases.map(release => [release.id, release]));
  for (const item of plan) {
    const release = byId.get(item.release.id);
    if (!release) throw new Error(`Release ${item.release.id} disappeared.`);
    if (release.tag_name !== item.newTag) throw new Error(`Release ${item.release.id} still uses ${release.tag_name}.`);
    if (JSON.stringify(releaseFingerprint(release)) !== JSON.stringify(item.fingerprint)) {
      throw new Error(`Release ${item.release.id} body, flags, or assets changed during migration.`);
    }
    const [oldRef, newRef] = await Promise.all([
      getRef(api, repository, item.oldTag),
      getRef(api, repository, item.newTag)
    ]);
    if (oldRef.object.sha !== item.oldRef.object.sha) throw new Error(`Legacy tag ${item.oldTag} changed target.`);
    if (newRef.object.sha !== item.oldRef.object.sha) throw new Error(`New tag ${item.newTag} has the wrong target.`);
  }
  assertSortableTags(releases.map(release => release.tag_name));
  return releases;
}

async function verifyMigratedState(api, repository, releases) {
  const remaining = buildPlan(releases);
  if (remaining.length) throw new Error(`${remaining.length} legacy nightly release tag(s) still require migration.`);
  const migrated = releases.filter(release => release.prerelease && SORTABLE_NIGHTLY.test(release.tag_name));
  let retainedLegacyAliases = 0;
  await mapConcurrent(migrated, 8, async release => {
    const match = SORTABLE_NIGHTLY.exec(release.tag_name);
    const oldTag = `v${match[1]}.${match[2]}.${match[3]}-nightly.${Number(match[4])}.${match[5]}`;
    const [oldRef, newRef] = await Promise.all([
      getRef(api, repository, oldTag, false),
      getRef(api, repository, release.tag_name)
    ]);
    if (oldRef && oldRef.object.sha !== newRef.object.sha) {
      throw new Error(`${oldTag} and ${release.tag_name} do not point to the same Git object.`);
    }
    if (oldRef) retainedLegacyAliases += 1;
  });
  assertSortableTags(releases.map(release => release.tag_name));
  return { migrated, retainedLegacyAliases };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const api = createClient(credential(options.apply));
  const releases = await listReleases(api, options.repository);
  if (options.verifyOnly) {
    const verified = await verifyMigratedState(api, options.repository, releases);
    console.log(`Verified ${verified.migrated.length} sortable release(s), including ${verified.retainedLegacyAliases} retained legacy aliases.`);
    return verified;
  }
  const plan = buildPlan(releases);
  await preflight(api, options.repository, plan);
  const summary = plan.map(item => ({
    releaseId: item.release.id,
    oldTag: item.oldTag,
    newTag: item.newTag,
    target: item.oldRef.object.sha,
    newTagAlreadyExists: Boolean(item.newRef),
    assetCount: (item.release.assets || []).length
  }));
  if (options.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`${options.apply ? 'Apply' : 'Dry-run'} plan for ${options.repository}: ${plan.length} release(s).`);
    for (const item of summary) console.log(`${item.oldTag} -> ${item.newTag} (${item.assetCount} assets, ${item.target})`);
  }
  if (!options.apply) {
    assertSortableTags([...releases.map(release => release.tag_name).filter(tag => !migratedTag(tag)), ...plan.map(item => item.newTag)]);
    if (!options.json) {
      console.log(`No changes made. Re-run with --apply --confirm-retag=${options.repository} to execute.`);
    }
    return summary;
  }
  await applyPlan(api, options.repository, plan, message => console.log(message));
  await verifyPlan(api, options.repository, plan);
  console.log(`Verified ${plan.length} retagged release(s): old refs retained; release bodies, flags, and asset identities unchanged.`);
  return summary;
}

export {
  LEGACY_NIGHTLY,
  SORTABLE_NIGHTLY,
  assertSortableTags,
  buildPlan,
  migratedTag,
  parseArguments,
  releaseFingerprint
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
