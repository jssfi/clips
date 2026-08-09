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
