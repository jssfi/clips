# Clips update origin

This legacy Worker keeps the old `cdn.clips.jss.fi` endpoint alive for installed builds that have not yet migrated.

Public routes support `GET`, `HEAD`, conditional requests, and single byte ranges. Only the update manifests and versioned Clips installer/application artifacts are accessible. The response body streams directly from R2.

## Deploy

```powershell
npm install
npx wrangler login
npm run types
npm run check
npm run deploy
```

Current releases are published through `clips-worker\scripts\publish.ps1`.

Worker names, domains, bucket names, and binding types are generated into ignored files from `.env`; see the root `.env.example`.
