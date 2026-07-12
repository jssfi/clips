const { OBSWebSocket } = require('obs-websocket-js');

class ObsController {
  constructor(onEvent) {
    this.obs = new OBSWebSocket();
    this.connected = false;
    this.onEvent = onEvent;
    this.desktopMuteState = new Map();
    this.obs.on('ConnectionClosed', () => { this.connected = false; this.onEvent?.(); });
    this.obs.on('RecordStateChanged', () => this.onEvent?.());
    this.obs.on('ReplayBufferStateChanged', () => this.onEvent?.());
  }

  async connect(port, password) {
    await this.obs.disconnect().catch(() => {});
    const result = await this.obs.connect(`ws://127.0.0.1:${port}`, password || undefined, { rpcVersion: 1 });
    this.connected = true;
    this.onEvent?.();
    return result;
  }

  async status() {
    if (!this.connected) return { connected: false, recording: false, replayBuffer: false };
    try {
      const [record, replay] = await Promise.all([
        this.obs.call('GetRecordStatus'),
        this.obs.call('GetReplayBufferStatus').catch(() => ({ outputActive: false }))
      ]);
      return { connected: true, recording: record.outputActive, paused: record.outputPaused, replayBuffer: replay.outputActive, durationMs: record.outputDuration };
    } catch {
      this.connected = false;
      return { connected: false, recording: false, replayBuffer: false };
    }
  }

  call(name, data) { return this.obs.call(name, data); }

  async startSession(outputDirectory) {
    await this.call('SetRecordDirectory', { recordDirectory: outputDirectory });
    const replay = await this.call('GetReplayBufferStatus').catch(() => ({ outputActive: false }));
    if (!replay.outputActive) await this.call('StartReplayBuffer').catch(() => {});
    const record = await this.call('GetRecordStatus');
    if (!record.outputActive) await this.call('StartRecord');
  }

  async configureApplicationAudio(applications) {
    const { inputs } = await this.call('GetInputList');
    for (const input of inputs.filter(item => item.unversionedInputKind === 'wasapi_output_capture')) {
      if (!this.desktopMuteState.has(input.inputName)) {
        const { inputMuted } = await this.call('GetInputMute', { inputName: input.inputName });
        this.desktopMuteState.set(input.inputName, inputMuted);
      }
      await this.call('SetInputMute', { inputName: input.inputName, inputMuted: true });
    }

    const { currentProgramSceneName } = await this.call('GetCurrentProgramScene');
    const existing = new Set(inputs.map(input => input.inputName));
    const unique = new Map(applications.filter(app => app?.name).map(app => [app.name.toLowerCase(), app]));
    for (const app of unique.values()) {
      const inputName = `Clippy Audio - ${app.name}`;
      const inputSettings = { window: `${app.title || ''}:${app.windowClass || ''}:${app.name}`, priority: 2 };
      if (existing.has(inputName)) {
        await this.call('SetInputSettings', { inputName, inputSettings, overlay: true });
      } else {
        await this.call('CreateInput', { sceneName: currentProgramSceneName, inputName, inputKind: 'wasapi_process_output_capture', inputSettings, sceneItemEnabled: true });
      }
    }
  }

  async restoreDesktopAudio() {
    for (const [inputName, inputMuted] of this.desktopMuteState) {
      await this.call('SetInputMute', { inputName, inputMuted }).catch(() => {});
    }
    this.desktopMuteState.clear();
  }

  async stopSession() {
    const record = await this.call('GetRecordStatus');
    if (record.outputActive) await this.call('StopRecord');
    const replay = await this.call('GetReplayBufferStatus').catch(() => ({ outputActive: false }));
    if (replay.outputActive) await this.call('StopReplayBuffer').catch(() => {});
    await this.restoreDesktopAudio();
  }

  async saveClip() {
    const replay = await this.call('GetReplayBufferStatus');
    if (!replay.outputActive) await this.call('StartReplayBuffer');
    return this.call('SaveReplayBuffer');
  }

  async setReplayBufferDuration(seconds) {
    const value = String(Math.max(5, Math.round(seconds)));
    const status = await this.call('GetReplayBufferStatus').catch(() => ({ outputActive: false }));
    if (status.outputActive) await this.call('StopReplayBuffer');
    for (const parameterCategory of ['SimpleOutput', 'AdvOut']) {
      await this.call('SetProfileParameter', { parameterCategory, parameterName: 'RecRB', parameterValue: 'true' });
      await this.call('SetProfileParameter', { parameterCategory, parameterName: 'RecRBTime', parameterValue: value });
    }
    await this.call('StartReplayBuffer');
  }
}

module.exports = { ObsController };
