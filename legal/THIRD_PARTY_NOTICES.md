# Third-party software notices

Clips includes or downloads third-party components. Those components are not
licensed under the Clips MIT license; their respective licenses apply.

## OBS Studio and libobs

- Distributed version: OBS Studio/libobs 31.1.2 for Windows x64.
- License: GNU General Public License version 2 or later.
- Project: https://github.com/obsproject/obs-studio
- Exact source: https://github.com/obsproject/obs-studio/tree/31.1.2
- Source archive: https://github.com/obsproject/obs-studio/archive/refs/tags/31.1.2.zip

The Clips native capture host links with libobs and is licensed under
GPL-2.0-or-later. Its preferred source and build script are `native/capture-host.cpp`
and `scripts/build-capture-host.cmd` in the Clips source repository.

The packaged libobs runtime is staged from the official OBS Studio 31.1.2
Windows archive. Clips excludes the OBS frontend, Qt UI, browser plugin,
WebSocket plugin, and `obs64.exe`, but includes selected libobs plugins and
their dependencies. Their upstream notices and licenses remain applicable.

## MPV and libmpv

- Distributed version: mpv/libmpv v0.41.0-920-gdd5d17d32, Windows x64.
- Build release: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260808
- Build-system revision: https://github.com/shinchiro/mpv-winbuild-cmake/tree/cd1edc1
- Exact MPV source: https://github.com/mpv-player/mpv/tree/dd5d17d328
- Source archive: https://github.com/mpv-player/mpv/archive/dd5d17d328.zip
- License of this build: GNU General Public License version 2 or later.

The build is the default GPL MPV configuration, not MPV's optional LGPL-only
configuration. The Clips native libmpv host therefore uses GPL-2.0-or-later.
Its preferred source and build script are `native/mpv-host.cpp` and
`scripts/build-mpv-host.cmd` in the Clips source repository.

## FFmpeg

- Distributed version: FFmpeg N-125994-gf944afd04, Windows x64.
- Build release: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260808
- Build-system revision: https://github.com/shinchiro/mpv-winbuild-cmake/tree/cd1edc1
- Exact FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/f944afd04
- Source archive: https://github.com/FFmpeg/FFmpeg/archive/f944afd04.zip
- License of this build: GNU General Public License version 3 or later.

The executable reports both `--enable-gpl` and `--enable-version3`. It also
statically includes optional libraries. Exact dependency revisions and build
recipes are recorded by the linked mpv-winbuild-cmake revision.

## Electron and Chromium

- Electron version: 43.3.0.
- License: MIT, with Chromium and other bundled components under their own terms.
- Project: https://github.com/electron/electron

Electron's `LICENSE.electron.txt` and generated `LICENSES.chromium.html` are
included automatically beside the installed executable.

## 7-Zip

- Distributed executable: 7za 21.07 from the `7zip-bin` npm package.
- Project and source: https://www.7-zip.org/download.html
- License information: https://www.7-zip.org/license.txt

7-Zip is primarily LGPL-2.1-or-later with additional restrictions applying to
its unRAR code. The `7zip-bin` npm wrapper is MIT licensed.

## NVIDIA Audio Effects

Clips includes OBS's `nv-filters` plugin, covered by the OBS distribution's
licenses. NVIDIA Audio Effects SDK runtime libraries are not bundled by Clips;
supported users install NVIDIA's runtime separately under NVIDIA's terms.

## License texts and source availability

Copies of GPL-2.0, GPL-3.0, and LGPL-2.1 are included in the installed
`resources/legal/licenses` directory. See `SOURCE_OFFER.md` alongside this file
for corresponding-source availability.
