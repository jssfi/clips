const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const runtimeRoot = path.join(root, 'vendor');
const executable = path.join(runtimeRoot, 'libobs', 'bin', '64bit', 'clips-capture-host.exe');

function obsProcessIds() {
  try {
    return execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq obs64.exe', '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8'
    }).split(/\r?\n/)
      .filter(line => /"obs64\.exe"/i.test(line))
      .map(line => line.split(',')[1]?.replaceAll('"', ''))
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

async function main() {
  assert.equal(fs.existsSync(executable), true, `Capture host is missing: ${executable}`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-capture-host-test-'));
  const outputDirectory = path.join(temporary, 'output');
  const configRoot = path.join(temporary, 'config');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const obsBefore = obsProcessIds();
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const childExit = new Promise(resolve => child.once('exit', resolve));
  child.stderr.pipe(process.stderr);
  child.stdout.setEncoding('utf8');
  let buffer = '';
  let nextId = 0;
  const pending = new Map();
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const request = pending.get(response.id);
      if (!request) continue;
      clearTimeout(request.timeout);
      pending.delete(response.id);
      response.ok ? request.resolve(response) : request.reject(new Error(response.error));
    }
  });

  const request = (command, data = {}, timeoutMs = 60000) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Capture-host ${command} timed out.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ id, command, ...data })}\n`);
  });

  try {
    await request('initialize', {
      runtimeRoot,
      configRoot,
      width: 1280,
      height: 720,
      fps: 30,
      quality: 'Small',
      format: 'mkv',
      clipLengthSeconds: 5
    });
    const protectedCapture = process.env.CLIPS_CAPTURE_TEST_PROTECTED === '1';
    const started = await request('start', {
      directory: outputDirectory,
      microphoneDeviceId: process.env.CLIPS_CAPTURE_TEST_MICROPHONE || 'disabled',
      microphoneVolumePercent: process.env.CLIPS_CAPTURE_TEST_MICROPHONE_VOLUME == null
        ? 100
        : Number(process.env.CLIPS_CAPTURE_TEST_MICROPHONE_VOLUME),
      microphoneNoiseGateDb: -40,
      microphoneNvidiaNoiseRemoval: true,
      applications: [{
        name: process.env.CLIPS_CAPTURE_TEST_EXECUTABLE || 'clips-capture-test.exe',
        title: process.env.CLIPS_CAPTURE_TEST_TITLE || 'Clips Capture Test',
        windowClass: process.env.CLIPS_CAPTURE_TEST_CLASS || 'ClipsCaptureTest',
        path: protectedCapture ? '' : 'C:\\clips-capture-test.exe',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        captureVideo: true,
        captureDisplay: protectedCapture,
        captureAudio: true
      }]
    });
    assert.equal(started.recording, true);
    assert.equal(started.replayBuffer, true);
    if (process.env.CLIPS_CAPTURE_TEST_LIVE_MICROPHONE_VOLUME != null) {
      await request('microphoneVolume', {
        microphoneVolumePercent: Number(process.env.CLIPS_CAPTURE_TEST_LIVE_MICROPHONE_VOLUME)
      });
    }
    await new Promise(resolve => setTimeout(resolve, 6000));
    await request('status');
    await request('save');
    await new Promise(resolve => setTimeout(resolve, 2000));
    await request('stop');
    // Production also force-terminates the helper if libobs does not finish its
    // best-effort shutdown promptly. Do not turn that known native behavior into
    // a minute-long test hang or leave its recordings behind.
    await request('shutdown', {}, 10000).catch(error => {
      if (!/shutdown timed out/i.test(error.message)) throw error;
      child.kill();
    });
    assert.deepEqual(obsProcessIds(), obsBefore, 'The capture host must not launch OBS Studio.');
    const files = fs.readdirSync(outputDirectory)
      .map(name => ({ name, size: fs.statSync(path.join(outputDirectory, name)).size }));
    const recording = files.find(file => /^Recording .+\.mkv$/i.test(file.name));
    const replay = files.find(file => /^Replay .+\.mkv$/i.test(file.name));
    assert.ok(recording?.size > 1000, 'The libobs recording output was not created.');
    assert.ok(replay?.size > 1000, 'The libobs replay-buffer output was not created.');
    const probe = spawnSync(path.join(runtimeRoot, 'ffmpeg', 'ffmpeg.exe'), [
      '-hide_banner', '-i', path.join(outputDirectory, recording.name), '-t', '0', '-map', '0:a?', '-f', 'null', '-'
    ], { windowsHide: true, encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr || 'FFmpeg could not inspect the native recording.');
    const inputDescription = probe.stderr.split('Stream mapping:')[0];
    const audioStreams = [...inputDescription.matchAll(/^\s*Stream #0:\d+.*Audio:/gm)];
    assert.equal(audioStreams.length, 2, 'The recording must contain a Combined track and an application stem.');
    assert.match(inputDescription, /^\s*title\s*:\s*Combined\s*$/m);
    assert.match(inputDescription, /^\s*title\s*:\s*clips-capture-test\.exe\s*$/m);
    console.log(`Native capture host recorded ${recording.name} and ${replay.name} without obs64.exe.`);
  } finally {
    if (!child.killed) child.kill();
    await Promise.race([childExit, new Promise(resolve => setTimeout(resolve, 5000))]);
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
