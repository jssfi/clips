# Clips

Clips is a Windows tray app with a private native capture engine built directly on libobs. It detects selected game executables, records automatically into daily folders, manages storage automatically, and saves replay-buffer clips with a global hotkey. It does not launch OBS Studio or use OBS WebSocket.

## Run locally

1. Run `npm install`.
2. Run `npm run stage:libobs` and `npm run build:capture-host` once to prepare the native development runtime.
3. Run `npm start` and choose running games in Clips.
4. Configure quality, resolution, frame rate, format, and replay length in Clips.

The capture host creates private game-capture and application-audio sources for the selected game and configured audio executables. Desktop and browser audio are not mixed unless their executable is explicitly selected.

## Package

Run `npm run dist` for normal app updates. It writes a slim NSIS updater containing Clips, Electron, the native capture host, and the standalone MPV player, while libobs, FFmpeg, and libmpv remain in the versioned runtime under `%LOCALAPPDATA%\jss-clips\runtime`.

Run `npm run dist:bootstrap` for the installer distributed to new PCs. The bootstrap includes the complete media runtime and copies it into the persistent runtime directory on first launch. Use `npm run dist:fresh` when libobs, the capture host, FFmpeg, standalone MPV, or the native libmpv host changes; it restages those components and creates a new bootstrap installer. A full portable build remains available with `npm run dist:portable`.

`npm run dist:release` builds both the transition NSIS updater and a versioned application package. Packaged builds download, verify, and extract that application package into `%LOCALAPPDATA%\jss-clips\app-versions` in the background. The update button appears only when preparation is complete; clicking it switches the active-version pointer and restarts Clips without running an installer.

### Test capture locally

Run both native capture integration tests:

```powershell
npm run test:capture-host
npm run test:capture-controller
```

The first test starts recording and the replay buffer, saves both files, and verifies that no `obs64.exe` process was launched. The second tests Electron’s private IPC controller.

### Test the update flow locally

For a quick UI/restart test without packaging, run:

```powershell
npm run start:update-ready
```

For a real installer-to-installer update:

1. Build and install the current version with `npm run dist`.
2. Increase the version in `package.json` and run `npm run dist` again.
3. Serve `dist/` with `npm run update:serve`.
4. Close Clips and launch the installed app from PowerShell with:

```powershell
$env:CLIPS_UPDATE_URL = 'http://127.0.0.1:8787'
& "$env:LOCALAPPDATA\Programs\jss clips\jss clips.exe"
```

The update icon appears after the newer installer has downloaded. The local server supports byte ranges so this exercises the same blockmap/differential download path as production.

Use `npm run stage:obs -- -Source D:\path\to\obs-studio`, followed by `npm run stage:libobs`, when the source OBS installation is elsewhere. The staging step copies only libobs, its Direct3D backend, capture/audio plugins, muxers, and encoders; it excludes `obs64.exe`, the OBS frontend, WebSocket, browser, and Qt UI. Use `npm run stage:mpv -- -Source D:\path\to\mpv.exe` to select the exact MPV build shipped with Clips.

The third-party libobs, FFmpeg, and MPV binaries are intentionally excluded from Git history.

## Retention safety

Storage cleanup only scans folders directly inside the configured storage directory whose names match `YYYY-MM-DD`. It can either delete expired recordings by age or delete the oldest recordings when the storage drive reaches a chosen usage percentage. Today’s possibly-active recordings and files using the `Replay` prefix are protected from disk-usage cleanup. Saved clips, day folders, subfolders, unrelated files, and folders with other names are never deleted.
