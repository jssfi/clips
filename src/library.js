const fs = require('fs');
const path = require('path');

function safeReadJson(filePath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

class LibraryMetadata {
  constructor(filePath, recordingsFolder) {
    this.filePath = filePath;
    this.recordingsFolder = path.resolve(recordingsFolder);
    this.items = safeReadJson(filePath, {});
  }
  key(filePath) {
    const relative = path.relative(this.recordingsFolder, path.resolve(String(filePath || '')));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
    return relative.replace(/\\/g, '/').toLowerCase();
  }
  get(filePath) { return this.items[this.key(filePath)] || {}; }
  update(filePath, change) {
    const key = this.key(filePath);
    if (!key) throw new Error('Recording is outside the Clips library.');
    const previous = this.items[key] || {};
    const next = { ...previous, ...change };
    next.title = String(next.title || '').trim().slice(0, 120);
    next.game = String(next.game || '').trim().slice(0, 120);
    next.tags = [...new Set((Array.isArray(next.tags) ? next.tags : []).map(value => String(value).trim()).filter(Boolean))].slice(0, 20);
    next.markers = (Array.isArray(next.markers) ? next.markers : []).map(marker => ({
      id: String(marker.id || ''), time: Math.max(0, Number(marker.time) || 0), label: String(marker.label || '').trim().slice(0, 80)
    })).filter(marker => marker.id).sort((a, b) => a.time - b.time);
    this.items[key] = next;
    this.persist();
    return next;
  }
  remove(filePath) { delete this.items[this.key(filePath)]; this.persist(); }
  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.working`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.items, null, 2)}\n`);
    fs.renameSync(temporary, this.filePath);
  }
}

function storageInsights(recordingsFolder, recordings) {
  let drive = { total: 0, free: 0 };
  try { const stats = fs.statfsSync(recordingsFolder); drive = { total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize }; } catch {}
  const groups = {};
  let totalBytes = 0;
  for (const recording of recordings) {
    totalBytes += Number(recording.bytes) || 0;
    const game = recording.game || 'Older recordings (game unknown)';
    groups[game] = (groups[game] || 0) + (Number(recording.bytes) || 0);
  }
  return { totalBytes, driveTotalBytes: drive.total, driveFreeBytes: drive.free,
    byGame: Object.entries(groups).map(([game, bytes]) => ({ game, bytes })).sort((a, b) => b.bytes - a.bytes) };
}

function concatManifest(paths) {
  return paths.map(filePath => `file '${String(filePath).replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

module.exports = { LibraryMetadata, storageInsights, concatManifest };
