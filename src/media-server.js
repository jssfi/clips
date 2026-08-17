const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pipeline } = require('stream');

const EXPECTED_DISCONNECTS = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE']);

function mediaContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({ '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.flv': 'video/x-flv' })[extension] || 'application/octet-stream';
}

function createRecordingMediaServer({ validatePath, ffmpegPath, execFile, spawn, logger }) {
  const tokens = new Map();
  let server = null;
  let port = 0;

  function invalidate(filePath) {
    for (const [token, entry] of tokens) if (entry.filePath === filePath) tokens.delete(token);
  }

  function serveFile(request, response, entry) {
    const target = validatePath(entry.filePath);
    const size = fs.statSync(target).size;
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = size - 1;
    if (range) {
      if (range[1]) start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
      if (!range[1] && range[2]) start = Math.max(0, size - Number(range[2]));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return;
      }
    }
    const headers = {
      'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
      'Content-Type': mediaContentType(target), 'Content-Length': String(end - start + 1)
    };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    pipeline(fs.createReadStream(target, { start, end }), response, error => {
      if (error && !EXPECTED_DISCONNECTS.has(error.code)) logger.warn('media response failed', { code: error.code, message: error.message });
    });
  }

  function serveBrowserStream(request, response, token, entry) {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'Content-Type': 'video/mp4',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const ffmpeg = spawn(ffmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-readrate', '1.25',
      ...(entry.startSeconds > 0 ? ['-ss', String(entry.startSeconds)] : []), '-i', entry.filePath,
      '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let disconnected = false;
    const stopStream = () => {
      if (disconnected) return;
      disconnected = true;
      tokens.delete(token);
      if (!ffmpeg.killed) ffmpeg.kill();
    };
    ffmpeg.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
    ffmpeg.on('error', error => logger.warn('browser media stream failed to start', { message: error.message }));
    ffmpeg.on('close', code => {
      tokens.delete(token);
      if (code && !disconnected && !response.destroyed) logger.warn('browser media stream ended early', { code, message: stderr.trim() });
    });
    request.on('aborted', stopStream);
    response.on('close', stopStream);
    pipeline(ffmpeg.stdout, response, error => {
      stopStream();
      if (error && !EXPECTED_DISCONNECTS.has(error.code)) logger.warn('browser media response failed', { code: error.code, message: error.message });
    });
  }

  async function start() {
    if (server) return;
    server = http.createServer((request, response) => {
      try {
        const token = new URL(request.url, 'http://127.0.0.1').pathname.split('/').pop();
        const entry = tokens.get(token);
        if (!entry) { response.writeHead(404); response.end(); return; }
        if (entry.stream) serveBrowserStream(request, response, token, entry);
        else serveFile(request, response, entry);
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); port = server.address().port; resolve(); });
    });
  }

  async function createStreamUrl(filePath, requestedStartSeconds = 0) {
    const target = validatePath(filePath);
    const startSeconds = Math.max(0, Number(requestedStartSeconds) || 0);
    const executable = ffmpegPath();
    if (!fs.existsSync(executable)) throw new Error('FFmpeg is missing from this Clips build.');
    let probeStderr = '';
    try {
      ({ stderr: probeStderr = '' } = await execFile(executable, ['-hide_banner', '-i', target, '-t', '0', '-f', 'null', '-'], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }));
    } catch (error) { probeStderr = String(error.stderr || ''); }
    const match = probeStderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
    if (!duration) throw new Error('Could not read the recording duration.');
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [token, entry] of tokens) if (entry.createdAt < cutoff) tokens.delete(token);
    const token = crypto.randomUUID();
    tokens.set(token, { filePath: target, startSeconds, stream: true, createdAt: Date.now() });
    return { url: `http://127.0.0.1:${port}/media/${token}`, duration, startSeconds };
  }

  function close() { server?.close(); server = null; port = 0; tokens.clear(); }
  return { start, close, invalidate, createStreamUrl };
}

module.exports = { createRecordingMediaServer, mediaContentType };
