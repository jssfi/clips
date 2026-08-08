# Repository instructions

## Required release workflow

After completing any application change in this repository:

1. Run `npm run check`.
2. Increase the patch version in both `package.json` and `package-lock.json` so installed nightly builds detect the update.
3. Rebuild the application. For ordinary changes, run `npm run dist:release` to create both the transition installer and the pre-extracted restart-only package. When OBS, FFmpeg, MPV, libmpv, or runtime packaging changes, run `npm run dist:fresh` first to produce the complete bootstrap installer, then run `npm run dist:release`.
4. Publish the nightly update with `powershell -NoProfile -ExecutionPolicy Bypass -File update-worker/scripts/publish.ps1`.
5. Verify both `https://cdn.clips.jss.fi/latest.yml` and `https://cdn.clips.jss.fi/latest.json` report the new version and that their referenced artifacts respond successfully before reporting the work complete.

Never finish an application-change task with only source edits unless the user explicitly says not to rebuild or not to publish.
