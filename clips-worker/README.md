# clips.jss.fi front door

This Worker owns the shared project hostname and routes each path to a focused service:

- `/cdn/` forwards to the update Worker.
- `/telemetry/` forwards to the opt-in telemetry Worker.
- `/app/` is reserved for the future project site.

The legacy `cdn.clips.jss.fi` and `telemetry.clips.jss.fi` custom domains remain attached directly to their Workers so already-installed builds continue working without depending on redirect behavior.

```powershell
npm install
npm run types
npm run check
npm run deploy
```

Worker names, domains, and service targets are generated into the ignored `wrangler.jsonc` from the repository-root `.env`; see `.env.example`.
