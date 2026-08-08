# Clips

Clips is a Windows tray app with a private native capture engine built directly on libobs. It detects selected game executables, records automatically into daily folders, manages storage automatically, and saves replay-buffer clips with a global hotkey. It does not launch OBS Studio or use OBS WebSocket.

![Clips recording library](docs/screenshots/library.png)

<details>
<summary>Settings</summary>

![Clips settings](docs/screenshots/settings.png)

</details>

## Native recording engine

- Recording runs through a private native libobs capture engine with game capture, per-application audio, replay-buffer clips, and HDR handling.
- Clips can automatically start recording when a configured game executable is detected.

## Audio and microphone

- Supports microphone selection, volume control, level monitoring, and a noise gate.
- Optional NVIDIA noise removal is available on supported systems.

## Recording library and playback

- Includes thumbnails, favorites, archives, multi-selection, and in-app recording deletion.
- Playback uses embedded libmpv with standalone MPV for fullscreen video.
- Supports lossless-style raw video trimming and automatic storage cleanup, while protecting active, saved, and favorite recordings.

## User interface

- Includes dedicated recent, library, and settings views with autosaving settings, a custom title bar, and tray controls.
- Shows in-game notifications when recording starts or stops and when a clip is saved.

## Updates

- Fast restart-only nightly updates include SHA-512 verification and rollback retention.
- Persistent runtime management for libobs, FFmpeg, MPV, and the native hosts keeps normal updates smaller and faster.

## Cloudflare distribution

- The repository includes the Cloudflare Worker and R2 publishing workflow used for application updates.
- Update delivery includes caching, metadata validation, byte-range support, and automatic cleanup of superseded artifacts.
- Nightly builds are distributed through `cdn.clips.jss.fi`.

## Privacy

- Electron renderers use sandboxing, context isolation, navigation blocking, and a restrictive Content Security Policy.
- Recording paths are validated, and local media URLs use random authentication tokens.

## Tests and releases

- Tests cover capture, settings, runtime installation, playback, logging, icons, and updates.
- Built, debugged, and shipped through 72 not-so-nightly releases.
- Tested with the help of a very "willing" friend, with surprisingly good results.

## Run locally

Clips currently targets 64-bit Windows. A source build needs:

- Windows 10 or newer on x64.
- Git and Node.js LTS.
- Visual Studio 2022 Build Tools with the Desktop development with C++ workload.
- OBS Studio 31.1.2 runtime and SDK sources.
- FFmpeg, MPV, and libmpv development files.

The repository includes a setup script that installs missing development tools through WinGet, downloads pinned OBS/FFmpeg/MPV/libmpv archives, verifies their SHA-256 checksums, stages them under the ignored `vendor/` directory, and builds the native hosts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-prerequisites.ps1
```

The Visual Studio installation is large and can require elevation. If the script installs Node or Git, open a new terminal afterward so the updated `PATH` is available.

Then install the JavaScript dependencies and start Clips:

```powershell
npm install
npm start
```

Once npm dependencies are installed, the setup script is also available as `npm run setup:prerequisites`. Pass `-Force` directly to the PowerShell script to redownload/restage the pinned media runtime, or `-SkipToolInstall` to require all system tools to already be installed.

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

Use `npm run stage:obs -- -Source D:\path\to\obs-studio`, followed by `npm run stage:libobs`, to stage a different OBS installation. The staging step copies only libobs, its Direct3D backend, capture/audio plugins, muxers, and encoders; it excludes `obs64.exe`, the OBS frontend, WebSocket, browser, and Qt UI. Use `npm run stage:ffmpeg -- -Source D:\path\to\ffmpeg.exe` or `npm run stage:mpv -- -Source D:\path\to\mpv.exe` to select alternate media builds.

Third-party media binaries are excluded from Git to keep the repository lightweight. They are bundled with published bootstrap installers and retained across slim updates. Source builds obtain verified copies through `scripts/install-prerequisites.ps1` instead of Git history.

## Retention safety

Storage cleanup only scans folders directly inside the configured storage directory whose names match `YYYY-MM-DD`. It can either delete expired recordings by age or delete the oldest recordings when the storage drive reaches a chosen usage percentage. Today’s possibly-active recordings and files using the `Replay` prefix are protected from disk-usage cleanup. Saved clips, day folders, subfolders, unrelated files, and folders with other names are never deleted.
