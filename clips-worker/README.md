# clips.jss.fi front door

This is the only Worker required for current Clips builds. It owns the shared project hostname and accesses both R2 buckets directly:

- `/cdn/` serves application updates.
- `/telemetry/` accepts opt-in telemetry.
- `/app/` serves an interactive browser demo built from the Electron renderer. Native capture, filesystem, and playback features remain desktop-only.
- `/download`, `/download/stable`, and `/download/setup` resolve the stable release metadata and redirect to the latest stable full setup installer for new PCs. `/download/` starts that download and then sends the browser to `/app/`.

The legacy hostnames are attached to this Worker and permanently redirect to their corresponding paths on the primary hostname. The old standalone Worker source remains under `legacy/` only as a rollback reference.

```powershell
npm install
npm run types
npm run check
npm run deploy
```

Publish locally built update artifacts from the repository root with `powershell -NoProfile -ExecutionPolicy Bypass -File clips-worker\scripts\publish.ps1`. The publisher creates and verifies a tagged GitHub Release first, then writes only mutable channel metadata to R2. Versioned `/cdn/` requests fall back to a 307 redirect to the matching GitHub asset. Nightly is the default; use `-Channel stable` or `-Channel both` when promoting a stable release.

Artifact publishing deliberately does not use Wrangler login credentials. Create an R2 API token scoped to Object Read & Write for only the update bucket, then expose its S3-compatible credentials to the publishing process as `CLIPS_R2_ACCOUNT_ID`, `CLIPS_R2_ACCESS_KEY_ID`, and `CLIPS_R2_SECRET_ACCESS_KEY`. Keep the token separate from the token or OAuth session used to deploy the Worker. The publisher refuses to fall back to broader Wrangler credentials.

The Worker name, domain, and R2 bindings are generated into the ignored `wrangler.jsonc` from the repository-root `.env`; see `.env.example`.
