# clips.jss.fi front door

This is the only Worker required for current Clips builds. It owns the shared project hostname and accesses both R2 buckets directly:

- `/cdn/` serves application updates.
- `/telemetry/` accepts opt-in telemetry.
- `/app/` serves an interactive browser demo built from the Electron renderer. Native capture, filesystem, and playback features remain desktop-only.
- `/download` resolves the current release metadata and redirects to the latest Windows installer.

The legacy hostnames are attached to this Worker and permanently redirect to their corresponding paths on the primary hostname. The old standalone Worker source remains under `legacy/` only as a rollback reference.

```powershell
npm install
npm run types
npm run check
npm run deploy
```

Publish update artifacts from the repository root with `powershell -NoProfile -ExecutionPolicy Bypass -File clips-worker\scripts\publish.ps1`. Nightly is the default; use `-Channel stable` or `-Channel both` when promoting a stable release.

Artifact publishing deliberately does not use Wrangler login credentials. Create an R2 API token scoped to Object Read & Write for only the update bucket, then expose its S3-compatible credentials to the publishing process as `CLIPS_R2_ACCOUNT_ID`, `CLIPS_R2_ACCESS_KEY_ID`, and `CLIPS_R2_SECRET_ACCESS_KEY`. Keep the token separate from the token or OAuth session used to deploy the Worker. The publisher refuses to fall back to broader Wrangler credentials.

The Worker name, domain, and R2 bindings are generated into the ignored `wrangler.jsonc` from the repository-root `.env`; see `.env.example`.
