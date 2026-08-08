const MAX_BODY_BYTES = 64 * 1024;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VersionEvent = {
  schemaVersion: 1;
  installationId: string;
  mode: 'version' | 'diagnostics';
  event: 'startup' | 'error';
  timestamp: string;
  appVersion: string;
  runtimeVersion: string;
  system?: { platform: string; architecture: string; windowsRelease: string; cpu: string; gpu: string; ramGiB: number };
  error?: { message: string; log: string };
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum ? value : null;
}

async function readLimitedBody(request: Request): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result.buffer;
}

function validate(input: unknown): VersionEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 1 || !UUID.test(String(value.installationId || ''))) return null;
  if (value.mode !== 'version' && value.mode !== 'diagnostics') return null;
  if (value.event !== 'startup' && value.event !== 'error') return null;
  if (value.event === 'error' && value.mode !== 'diagnostics') return null;
  if (!VERSION.test(String(value.appVersion || '')) || !text(value.runtimeVersion, 100)) return null;
  if (!text(value.timestamp, 40) || !Number.isFinite(Date.parse(String(value.timestamp)))) return null;
  const allowed = new Set(['schemaVersion', 'installationId', 'mode', 'event', 'timestamp', 'appVersion', 'runtimeVersion']);
  if (value.mode === 'diagnostics') allowed.add('system');
  if (value.event === 'error') allowed.add('error');
  if (Object.keys(value).some(key => !allowed.has(key))) return null;
  if (value.mode === 'version' && (value.system !== undefined || value.error !== undefined)) return null;
  if (value.mode === 'diagnostics') {
    const system = value.system as Record<string, unknown> | undefined;
    if (!system || !text(system.platform, 20) || !text(system.architecture, 20) || !text(system.windowsRelease, 100)
      || !text(system.cpu, 300) || !text(system.gpu, 300) || !Number.isInteger(system.ramGiB) || Number(system.ramGiB) < 1 || Number(system.ramGiB) > 4096) return null;
    if (Object.keys(system).some(key => !['platform', 'architecture', 'windowsRelease', 'cpu', 'gpu', 'ramGiB'].includes(key))) return null;
  }
  if (value.event === 'error') {
    const error = value.error as Record<string, unknown> | undefined;
    if (!error || !text(error.message, 1000) || typeof error.log !== 'string' || new TextEncoder().encode(error.log).length > 48 * 1024) return null;
    if (Object.keys(error).some(key => !['message', 'log'].includes(key))) return null;
  }
  return value as VersionEvent;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/events') return json({ error: 'Not found' }, 404);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'JSON required' }, 415);
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
    const bytes = await readLimitedBody(request);
    if (!bytes) return json({ error: 'Payload too large' }, 413);
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return json({ error: 'Invalid JSON' }, 400); }
    const event = validate(parsed);
    if (!event) return json({ error: 'Invalid event' }, 400);

    const receivedAt = new Date().toISOString();
    const current = JSON.stringify({
      schemaVersion: event.schemaVersion,
      installationId: event.installationId,
      mode: event.mode,
      appVersion: event.appVersion,
      runtimeVersion: event.runtimeVersion,
      ...(event.system ? { system: event.system } : {}),
      receivedAt
    });
    await env.TELEMETRY.put(`installations/${event.installationId}.json`, current, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { appVersion: event.appVersion, mode: event.mode, receivedAt }
    });
    if (event.event === 'error') {
      const day = receivedAt.slice(0, 10);
      await env.TELEMETRY.put(`errors/${day}/${event.installationId}/${crypto.randomUUID()}.json`, JSON.stringify({ ...event, receivedAt }), {
        httpMetadata: { contentType: 'application/json' }
      });
    }
    return json({ accepted: true }, 202);
  }
} satisfies ExportedHandler<Env>;
