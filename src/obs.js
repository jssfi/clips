const { spawn } = require('child_process');
const path = require('path');

class ObsController {
  constructor(onEvent, logger) {
    this.onEvent = onEvent;
    this.logger = logger;
    this.child = null;
    this.connected = false;
    this.nextRequestId = 0;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.settings = null;
    this.applications = [];
    this.lastStatus = { connected: false, recording: false, replayBuffer: false, durationMs: 0 };
  }

  request(command, data = {}, timeoutMs = 30000) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error('The Clips capture engine is offline.'));
    const id = ++this.nextRequestId;
    if (command !== 'status') {
      this.logger?.info('capture request', {
        id,
        command,
        directory: data.directory,
        microphoneDeviceId: data.microphoneDeviceId,
        microphoneVolumePercent: data.microphoneVolumePercent,
        applicationCount: data.applications?.length
      });
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The Clips capture engine timed out while handling ${command}.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, command, ...data })}\n`, error => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    while (this.stdoutBuffer.includes('\n')) {
      const newline = this.stdoutBuffer.indexOf('\n');
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
      this.lastStatus = {
        connected: !!response.connected,
        recording: !!response.recording,
        replayBuffer: !!response.replayBuffer,
        durationMs: Number(response.durationMs) || 0
      };
      if (response.ok) pending.resolve(response);
      else {
        this.logger?.error('capture request failed', { id: response.id, error: response.error });
        pending.reject(new Error(response.error || 'The Clips capture engine failed.'));
      }
    }
  }

  handleExit(error) {
    const failure = error instanceof Error ? error : new Error('The Clips capture engine stopped unexpectedly.');
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(failure);
    }
    this.pending.clear();
    this.child = null;
    this.connected = false;
    this.lastStatus = { connected: false, recording: false, replayBuffer: false, durationMs: 0 };
    this.onEvent?.();
  }

  async connect({ executable, runtimeRoot, configRoot, settings }) {
    if (this.connected && this.child) return true;
    if (this.child) await this.disconnect();
    this.settings = { ...settings };
    this.stdoutBuffer = '';
    const child = spawn(executable, [], {
      cwd: path.join(runtimeRoot, 'libobs', 'bin', '64bit'),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.handleStdout(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      this.logger?.capture(chunk);
      if (process.env.CLIPS_CAPTURE_LOG === '1') process.stderr.write(chunk);
    });
    child.once('error', error => this.handleExit(error));
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.handleExit(new Error(`The Clips capture engine exited (${signal || code}).`));
    });
    const [width, height] = String(settings.obsResolution).split('x').map(Number);
    try {
      await this.request('initialize', {
        runtimeRoot,
        configRoot,
        width,
        height,
        fps: Number(settings.obsFps),
        quality: settings.obsRecordingQuality,
        format: settings.obsFormat,
        clipLengthSeconds: Number(settings.clipLengthSeconds)
      }, 60000);
      this.connected = true;
      this.lastStatus.connected = true;
      this.onEvent?.();
      return true;
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    const child = this.child;
    if (!child) return;
    await this.request('shutdown', {}, 10000).catch(() => {});
    this.child = null;
    this.connected = false;
    if (!child.killed) child.kill();
    this.handleExit(new Error('The Clips capture engine was stopped.'));
  }

  async status() {
    if (!this.connected || !this.child) return { connected: false, recording: false, replayBuffer: false };
    try {
      await this.request('status');
      return { ...this.lastStatus };
    } catch {
      return { connected: false, recording: false, replayBuffer: false };
    }
  }

  async configureApplicationAudio(applications) {
    this.applications = applications.map(application => ({ ...application }));
  }

  async startSession(outputDirectory, activeGames = [], microphoneDeviceId = 'disabled', microphoneVolumePercent = 100, microphoneNoiseGateDb = -40, microphoneNvidiaNoiseRemoval = true) {
    const video = new Set(activeGames.map(name => name.toLowerCase()));
    const applications = this.applications.map(application => ({
      ...application,
      captureVideo: video.has(application.name.toLowerCase()),
      captureDisplay: video.has(application.name.toLowerCase()) && !application.path,
      captureAudio: true
    }));
    if (!video.size) {
      applications.push({
        name: 'clips-desktop-capture',
        title: '',
        windowClass: '',
        path: '',
        bounds: null,
        captureVideo: true,
        captureDisplay: true,
        captureAudio: true
      });
    }
    await this.request('start', {
      directory: outputDirectory,
      applications,
      microphoneDeviceId,
      microphoneVolumePercent,
      microphoneNoiseGateDb,
      microphoneNvidiaNoiseRemoval
    }, 45000);
  }

  async setMicrophoneVolume(percent) {
    if (!this.connected) return;
    await this.request('microphoneVolume', {
      microphoneVolumePercent: Math.min(200, Math.max(0, Number(percent) || 0))
    });
  }

  async setMicrophoneNoiseGate(thresholdDb) {
    if (!this.connected) return;
    await this.request('microphoneNoiseGate', {
      microphoneNoiseGateDb: Math.min(-5, Math.max(-60, Number(thresholdDb) || -40))
    });
  }

  async microphoneLevel() {
    if (!this.connected) return -60;
    const response = await this.request('microphoneLevel');
    return Math.min(0, Math.max(-60, Number(response.microphoneLevelDb) || -60));
  }

  async setMicrophoneNvidiaNoiseRemoval(enabled) {
    if (!this.connected) return;
    await this.request('microphoneNvidiaNoiseRemoval', { microphoneNvidiaNoiseRemoval: !!enabled });
  }

  async microphones() {
    if (!this.connected) return [];
    const response = await this.request('microphones');
    return Array.isArray(response.devices) ? response.devices : [];
  }

  async stopSession() {
    if (!this.connected) return;
    await this.request('stop', {}, 60000);
  }

  async saveClip() {
    await this.request('save');
  }

  async applyRecordingSettings({ quality, resolution, fps, format, clipLengthSeconds }) {
    if (!this.connected) return;
    const [width, height] = String(resolution).split('x').map(Number);
    this.settings = {
      ...this.settings,
      obsRecordingQuality: quality,
      obsResolution: resolution,
      obsFps: fps,
      obsFormat: format,
      clipLengthSeconds: clipLengthSeconds ?? this.settings?.clipLengthSeconds
    };
    await this.request('configure', {
      width,
      height,
      fps: Number(fps),
      quality,
      format,
      clipLengthSeconds: Number(this.settings.clipLengthSeconds)
    }, 60000);
  }

  async setReplayBufferDuration(seconds) {
    if (!this.settings) return;
    await this.applyRecordingSettings({
      quality: this.settings.obsRecordingQuality,
      resolution: this.settings.obsResolution,
      fps: this.settings.obsFps,
      format: this.settings.obsFormat,
      clipLengthSeconds: seconds
    });
  }
}

module.exports = { ObsController };
