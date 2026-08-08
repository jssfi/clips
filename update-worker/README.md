# Clips update origin

This Worker exposes Electron update artifacts from the R2 bucket configured in the repository-root `.env`.

Public routes support `GET`, `HEAD`, conditional requests, and single byte ranges. Only the update manifests and versioned Clips installer/application artifacts are accessible. The response body streams directly from R2.

## Deploy

```powershell
npm install
npx wrangler login
npm run types
npm run check
npm run deploy
```

## Publish a release

Build the transition installer and the pre-extracted restart-only update from the repository root, then upload them:

```powershell
npm run dist:release
powershell -NoProfile -ExecutionPolicy Bypass -File update-worker\scripts\publish.ps1
```

The publisher uploads immutable artifacts before replacing `latest.yml` and `latest.json`, then deletes the superseded artifacts. Clients never see metadata for an unavailable artifact.

Worker names, domains, bucket names, and binding types are generated into ignored files from `.env`; see the root `.env.example`.
