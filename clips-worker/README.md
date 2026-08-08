# clips.jss.fi front door

This is the only Worker required for current Clips builds. It owns the shared project hostname and accesses both R2 buckets directly:

- `/cdn/` serves application updates.
- `/telemetry/` accepts opt-in telemetry.
- `/app/` is reserved for the future project site.

The legacy hostnames are attached to this Worker and permanently redirect to their corresponding paths on the primary hostname. The old standalone Worker source remains under `legacy/` only as a rollback reference.

```powershell
npm install
npm run types
npm run check
npm run deploy
```

Publish update artifacts from the repository root with `powershell -NoProfile -ExecutionPolicy Bypass -File clips-worker\scripts\publish.ps1`. Nightly is the default; use `-Channel stable` or `-Channel both` when promoting a stable release.

The Worker name, domain, and R2 bindings are generated into the ignored `wrangler.jsonc` from the repository-root `.env`; see `.env.example`.
