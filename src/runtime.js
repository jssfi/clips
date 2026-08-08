const fs = require('fs');
const path = require('path');

const RUNTIME_VERSION = 2;
const LIBOBS_BIN_FILES = [
  'obs.dll',
  'libobs-d3d11.dll',
  'libobs-winrt.dll',
  'avcodec-61.dll',
  'avdevice-61.dll',
  'avfilter-10.dll',
  'avformat-61.dll',
  'avutil-59.dll',
  'swresample-5.dll',
  'swscale-8.dll',
  'w32-pthreads.dll',
  'zlib.dll',
  'libcurl.dll',
  'librist.dll',
  'srt.dll',
  'libx264-164.dll',
  'obs-ffmpeg-mux.exe',
  'obs-nvenc-test.exe',
  'obs-qsv-test.exe'
];
const LIBOBS_PLUGINS = [
  'win-capture',
  'win-wasapi',
  'obs-ffmpeg',
  'obs-x264',
  'obs-nvenc',
  'obs-qsv11',
  'coreaudio-encoder',
  'obs-filters',
  'nv-filters'
];
const REQUIRED_FILES = [
  path.join('libobs', 'bin', '64bit', 'obs.dll'),
  path.join('libobs', 'bin', '64bit', 'clips-capture-host.exe'),
  path.join('libobs', 'obs-plugins', '64bit', 'win-capture.dll'),
  path.join('libobs', 'obs-plugins', '64bit', 'win-wasapi.dll'),
  path.join('libobs', 'obs-plugins', '64bit', 'obs-ffmpeg.dll'),
  path.join('ffmpeg', 'ffmpeg.exe'),
  path.join('libmpv', 'mpv-host.exe'),
  path.join('libmpv', 'libmpv-2.dll')
];

function runtimeRoot(localAppData) {
  return path.join(localAppData, 'jss-clips', 'runtime', `v${RUNTIME_VERSION}`);
}

function manifestPath(root) {
  return path.join(root, 'runtime.json');
}

function isRuntimeReady(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
    return manifest.version === RUNTIME_VERSION
      && REQUIRED_FILES.every(relative => fs.statSync(path.join(root, relative)).size > 0);
  } catch {
    return false;
  }
}

async function copyPrivateLibobs(source, destination) {
  const sourceBin = path.join(source, 'bin', '64bit');
  const sourcePlugins = path.join(source, 'obs-plugins', '64bit');
  const sourceData = path.join(source, 'data');
  const destinationBin = path.join(destination, 'bin', '64bit');
  const destinationPlugins = path.join(destination, 'obs-plugins', '64bit');
  const destinationData = path.join(destination, 'data');
  await fs.promises.mkdir(destinationBin, { recursive: true });
  await fs.promises.mkdir(destinationPlugins, { recursive: true });
  await fs.promises.mkdir(destinationData, { recursive: true });
  for (const name of LIBOBS_BIN_FILES) {
    await fs.promises.copyFile(path.join(sourceBin, name), path.join(destinationBin, name));
  }
  for (const name of LIBOBS_PLUGINS) {
    await fs.promises.copyFile(
      path.join(sourcePlugins, `${name}.dll`),
      path.join(destinationPlugins, `${name}.dll`)
    );
    const pluginData = path.join(sourceData, 'obs-plugins', name);
    if (fs.existsSync(pluginData)) {
      await fs.promises.cp(
        pluginData,
        path.join(destinationData, 'obs-plugins', name),
        { recursive: true, force: true }
      );
    }
  }
  await fs.promises.cp(
    path.join(sourceData, 'libobs'),
    path.join(destinationData, 'libobs'),
    { recursive: true, force: true }
  );
}

async function ensureRuntimeInstalled(resourcesPath, root) {
  let installed = false;
  if (!isRuntimeReady(root)) {
    const previousRoot = path.join(path.dirname(root), 'v1');
    const componentSource = name => {
      const bundled = path.join(resourcesPath, name);
      if (fs.existsSync(bundled)) return bundled;
      const previous = path.join(previousRoot, name);
      return fs.existsSync(previous) ? previous : '';
    };
    const bundledLibobs = path.join(resourcesPath, 'libobs');
    const obsSource = fs.existsSync(bundledLibobs)
      ? bundledLibobs
      : path.join(previousRoot, 'obs-studio');
    const ffmpegSource = componentSource('ffmpeg');
    const libmpvSource = componentSource('libmpv');
    if (!obsSource || !ffmpegSource || !libmpvSource) {
      throw new Error('The bundled media runtime and its previous installed version are incomplete.');
    }

    await fs.promises.mkdir(root, { recursive: true });
    await copyPrivateLibobs(
      obsSource,
      path.join(root, 'libobs')
    );
    const bundledCaptureHost = path.join(resourcesPath, 'capture-host', 'clips-capture-host.exe');
    if (fs.existsSync(bundledCaptureHost)) {
      await fs.promises.copyFile(
        bundledCaptureHost,
        path.join(root, 'libobs', 'bin', '64bit', 'clips-capture-host.exe')
      );
    }
    await fs.promises.mkdir(path.join(root, 'ffmpeg'), { recursive: true });
    await fs.promises.copyFile(
      path.join(ffmpegSource, 'ffmpeg.exe'),
      path.join(root, 'ffmpeg', 'ffmpeg.exe')
    );
    await fs.promises.mkdir(path.join(root, 'libmpv'), { recursive: true });
    await Promise.all([
      fs.promises.copyFile(
        path.join(libmpvSource, 'mpv-host.exe'),
        path.join(root, 'libmpv', 'mpv-host.exe')
      ),
      fs.promises.copyFile(
        path.join(libmpvSource, 'libmpv-2.dll'),
        path.join(root, 'libmpv', 'libmpv-2.dll')
      )
    ]);
    for (const relative of REQUIRED_FILES) {
      const installedFile = path.join(root, relative);
      if (!fs.existsSync(installedFile) || fs.statSync(installedFile).size <= 0) {
        throw new Error(`Installed media runtime is incomplete: ${relative}`);
      }
    }
    await fs.promises.writeFile(manifestPath(root), `${JSON.stringify({
      version: RUNTIME_VERSION,
      installedAt: new Date().toISOString()
    }, null, 2)}\n`);
    installed = true;
  }

  // Slim application updates can ship a corrected native capture host without
  // redownloading the complete OBS runtime. Refresh it even when the runtime
  // version itself is already installed.
  const bundledCaptureHost = path.join(resourcesPath, 'capture-host', 'clips-capture-host.exe');
  const installedCaptureHost = path.join(root, 'libobs', 'bin', '64bit', 'clips-capture-host.exe');
  if (fs.existsSync(bundledCaptureHost)) {
    await fs.promises.mkdir(path.dirname(installedCaptureHost), { recursive: true });
    await fs.promises.copyFile(bundledCaptureHost, installedCaptureHost);
    installed = true;
  }

  // Older v2 runtimes predate microphone filters. Slim updates refresh the
  // plugin and its data alongside the capture host.
  const bundledMicrophoneFilters = path.join(resourcesPath, 'microphone-filters');
  const bundledFilterDll = path.join(bundledMicrophoneFilters, 'obs-filters.dll');
  if (fs.existsSync(bundledFilterDll)) {
    const installedPlugins = path.join(root, 'libobs', 'obs-plugins', '64bit');
    await fs.promises.mkdir(installedPlugins, { recursive: true });
    for (const name of ['obs-filters.dll', 'nv-filters.dll']) {
      const bundledPlugin = path.join(bundledMicrophoneFilters, name);
      if (fs.existsSync(bundledPlugin))
        await fs.promises.copyFile(bundledPlugin, path.join(installedPlugins, name));
    }
    const bundledFilterData = path.join(bundledMicrophoneFilters, 'data');
    if (fs.existsSync(bundledFilterData)) {
      await fs.promises.cp(bundledFilterData,
        path.join(root, 'libobs', 'data', 'obs-plugins', 'obs-filters'),
        { recursive: true, force: true });
    }
    installed = true;
  }

  // Refresh the embedded player host and its matching library as part of slim
  // application updates so new player commands work without a bootstrap reinstall.
  const bundledLibmpv = path.join(resourcesPath, 'libmpv');
  const installedLibmpv = path.join(root, 'libmpv');
  const bundledMpvHost = path.join(bundledLibmpv, 'mpv-host.exe');
  const bundledMpvLibrary = path.join(bundledLibmpv, 'libmpv-2.dll');
  if (fs.existsSync(bundledMpvHost) && fs.existsSync(bundledMpvLibrary)) {
    await fs.promises.mkdir(installedLibmpv, { recursive: true });
    await Promise.all([
      fs.promises.copyFile(bundledMpvHost, path.join(installedLibmpv, 'mpv-host.exe')),
      fs.promises.copyFile(bundledMpvLibrary, path.join(installedLibmpv, 'libmpv-2.dll'))
    ]);
    installed = true;
  }

  // MPV is also shipped in slim updates so existing v1 runtimes can gain
  // standalone playback without redownloading the much larger OBS runtime.
  const bundledMpv = path.join(resourcesPath, 'mpv', 'mpv.exe');
  const installedMpv = path.join(root, 'mpv', 'mpv.exe');
  const previousMpv = path.join(path.dirname(root), 'v1', 'mpv', 'mpv.exe');
  const mpvSource = fs.existsSync(bundledMpv) ? bundledMpv : previousMpv;
  if (fs.existsSync(mpvSource) && !fs.existsSync(installedMpv)) {
    await fs.promises.mkdir(path.dirname(installedMpv), { recursive: true });
    await fs.promises.copyFile(mpvSource, installedMpv);
    installed = true;
  }
  return { installed, root };
}

module.exports = {
  RUNTIME_VERSION,
  REQUIRED_FILES,
  runtimeRoot,
  isRuntimeReady,
  ensureRuntimeInstalled
};
