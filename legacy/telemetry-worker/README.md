# Clips telemetry Worker

This Worker accepts the opt-in telemetry documented in the root README. Each startup overwrites `installations/<uuid>.json`, so one installation moving to a newer release remains one installation. Diagnostic errors are additionally retained under `errors/`.

The endpoint accepts only a strict 64 KiB JSON schema. It does not store request headers or IP addresses. Cloudflare still processes normal connection metadata before the request reaches the Worker.

`installations/` contains one current record per UUID. R2 object custom metadata includes `appVersion`, so the records can be grouped without opening diagnostic error objects. This is an installation/launch count, not a CDN download count.

```powershell
npm install
npm run types
npm run check
npm run deploy
```

Worker names, domains, and bucket names are generated into the ignored `wrangler.jsonc` from the repository-root `.env`; see `.env.example`.
