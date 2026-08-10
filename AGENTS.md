# Repository instructions

## Required release workflow

Every published build must have a user-facing entry in `src/changelog.json`.

### Nightly release

After completing an application change intended for nightly release:

1. Add the new entry at the start of `src/changelog.json` with `"version": "next"`.
2. Run `npm run check`.
3. Commit the application changes locally. Do not push unless the user explicitly asks.
4. Run `npm run version:nightly -- <stable-major.minor>`. This derives a monotonically ordered internal SemVer and the displayed `<major.minor>-<short-commit-hash>` from the committed source snapshot.
5. Commit the generated `package.json`, `package-lock.json`, and changelog version as a local release-metadata commit. Do not push unless explicitly asked.
6. Rebuild the application. For ordinary changes, run `npm run dist:release`. When OBS, FFmpeg, MPV, libmpv, or runtime packaging changes, run `npm run dist:fresh` first, then run `npm run dist:release`.
7. Publish nightly with `powershell -NoProfile -ExecutionPolicy Bypass -File clips-worker/scripts/publish.ps1`.
8. Verify `https://cdn.clips.jss.fi/latest.yml`, `https://cdn.clips.jss.fi/latest.json`, and every referenced artifact.

### Stable release

Only publish stable when the user explicitly approves that specific promotion. For a stable release:

1. Add or finalize the user-facing changelog entry before building.
2. Run `npm run check`.
3. Set the full SemVer in `package.json` and `package-lock.json`; a displayed `0.3` stable release uses internal version `0.3.0`.
4. Commit the stable release locally. Do not push unless explicitly asked.
5. Build using the same ordinary/fresh rules as nightly.
6. Publish to both channels with `powershell -NoProfile -ExecutionPolicy Bypass -File clips-worker/scripts/publish.ps1 -Channel both`, so nightly users also receive the stable baseline.
7. Verify both nightly metadata URLs, both `/stable` metadata URLs, and every referenced artifact.

Never finish an application-change task with only source edits unless the user explicitly says not to rebuild or not to publish.

## Backward compatibility for released clients

Treat every publicly distributed Clips version as an installed client that may still need to update. A change is not complete merely because the newest source and newest updater work together.

Before changing update URLs, redirects, metadata schemas, version formats, artifact names, signing requirements, runtime layouts, migration behavior, or installer contents:

1. Inspect the updater and runtime behavior in earlier public releases, including the oldest version reasonably expected to remain installed.
2. Preserve legacy endpoints and make metadata changes additive whenever possible. Do not introduce version strings, required fields, redirects, or artifact names that an older updater rejects.
3. Test representative upgrades from earlier stable and nightly builds to the proposed release, including update discovery, download, integrity validation, installation, restart, runtime migration, and rollback behavior.
4. If direct compatibility is impossible, publish and retain a compatible bridge release before changing the feed. Older clients must have an automated upgrade path to that bridge, and the bridge must understand the new format.
5. Do not remove metadata or artifacts still needed by supported upgrade paths. Keep a documented manual recovery installer as a fallback, but do not treat manual installation as a substitute for updater compatibility.

Release verification must cover the compatibility matrix, not only a fresh install and an update from the immediately previous development build.
