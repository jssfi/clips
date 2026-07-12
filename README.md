# Clippy

Clippy is a Windows tray app that uses OBS Studio as its recording engine. It detects selected game executables, records automatically into daily folders, deletes expired day folders, and saves OBS replay-buffer clips with a global hotkey.

## Run locally

1. Run `npm install`, then `npm start`.
2. Development mode uses the system OBS install. Packaged builds include OBS Studio and launch it minimized.
3. Choose running games in Clippy.
4. In OBS, configure your encoder/quality and enable Replay Buffer under **Settings → Output**.

For isolated audio, disable global Desktop Audio and add **Application Audio Capture (BETA)** sources for the game and Discord. This keeps browser/system audio out. OBS 30.1+ can also attach audio capture directly to Game/Window Capture sources.

## Package

Run `npm run dist`. The build first stages the installed OBS runtime from `C:\Program Files\obs-studio`, then writes the installer and portable executable to `dist/`. Use `npm run stage:obs -- -Source D:\path\to\obs-studio` when OBS is installed elsewhere.

The third-party OBS runtime is intentionally excluded from Git history.

## Retention safety

Only folders directly inside the configured storage directory whose names match `YYYY-MM-DD` are deleted. Other files and folders are never touched.
