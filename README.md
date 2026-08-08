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

## Development

Clips targets 64-bit Windows. The repository includes an automated prerequisite installer for the native toolchain and pinned media runtimes.

See [Development and testing](docs/development.md) for source setup, packaging, integration tests, update-flow testing, and alternate runtime staging.

## Retention safety

Storage cleanup only scans folders directly inside the configured storage directory whose names match `YYYY-MM-DD`. It can either delete expired recordings by age or delete the oldest recordings when the storage drive reaches a chosen usage percentage. Today's possibly-active recordings and files using the `Replay` prefix are protected from disk-usage cleanup. Saved clips, day folders, subfolders, unrelated files, and folders with other names are never deleted.
