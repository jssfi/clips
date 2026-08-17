const fs = require('fs');
const path = require('path');

const VIDEO_EXTENSION = /\.(mkv|mp4|mov|webm|flv)$/i;
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;

function isRawRecordingName(name) {
  return VIDEO_EXTENSION.test(name)
    && !/^Replay(?:[ _-]|$)/i.test(name)
    && !/-trimmed(?:-\d+)?(?=\.[^.]+$)/i.test(name);
}

function createRecordingLibrary({ getSettings, getMetadata, favoritesPath, today = () => new Date().toLocaleDateString('sv-SE') }) {
  let favoriteKeys = new Set();
  const root = () => path.resolve(getSettings().recordingsFolder);
  const recordingKey = filePath => {
    const relative = path.relative(root(), path.resolve(String(filePath || '')));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
    return relative.replace(/\\/g, '/').toLowerCase();
  };
  const isFavorite = filePath => favoriteKeys.has(recordingKey(filePath));
  const enrich = recording => {
    const metadata = getMetadata()?.get(recording.path) || {};
    return { ...recording, ...metadata, title: metadata.title || recording.name, tags: metadata.tags || [], markers: metadata.markers || [], game: metadata.game || '' };
  };
  const persistFavorites = () => {
    const target = favoritesPath();
    const temporary = `${target}.working`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify([...favoriteKeys].sort(), null, 2)}\n`);
    fs.renameSync(temporary, target);
  };
  const recordingFilesByAge = ({ beforeToday = false } = {}) => {
    if (!fs.existsSync(root())) return [];
    const files = [];
    for (const day of fs.readdirSync(root(), { withFileTypes: true })) {
      if (!day.isDirectory() || !DAY_FOLDER.test(day.name) || (beforeToday && day.name >= today())) continue;
      const dayFolder = path.join(root(), day.name);
      for (const recording of fs.readdirSync(dayFolder, { withFileTypes: true })) {
        if (!recording.isFile() || !isRawRecordingName(recording.name)) continue;
        const filePath = path.join(dayFolder, recording.name);
        const stat = fs.statSync(filePath);
        files.push({ path: filePath, modified: stat.mtimeMs, bytes: stat.size, favorite: isFavorite(filePath) });
      }
    }
    return files.sort((a, b) => a.modified - b.modified);
  };
  const rawFootageBytes = () => recordingFilesByAge().reduce((total, recording) => total + recording.bytes, 0);
  const diskUsagePercent = () => {
    const stats = fs.statfsSync(root());
    return stats.blocks ? ((stats.blocks - stats.bavail) / stats.blocks) * 100 : 0;
  };

  return {
    loadFavorites() {
      try { favoriteKeys = new Set(JSON.parse(fs.readFileSync(favoritesPath(), 'utf8')).map(String)); }
      catch { favoriteKeys = new Set(); }
    },
    setFavorite(filePath, favorite, { persist = true } = {}) {
      const key = recordingKey(filePath);
      if (favorite) favoriteKeys.add(key); else favoriteKeys.delete(key);
      if (persist) persistFavorites();
    },
    persistFavorites,
    isRawRecordingName,
    cleanupStorage(ensureDirectory) {
      const settings = getSettings();
      ensureDirectory(settings.recordingsFolder);
      if (settings.storageCleanupMode === 'disk') {
        const limit = Math.min(99, Math.max(1, Number(settings.maxDiskUsagePercent) || 80));
        const rawLimit = Math.max(1, Number(settings.maxRawRecordingGigabytes) || 250) * 1024 ** 3;
        const isOverLimit = () => diskUsagePercent() >= limit || rawFootageBytes() > rawLimit;
        if (!isOverLimit()) return;
        for (const recording of recordingFilesByAge({ beforeToday: true })) {
          if (recording.favorite) continue;
          fs.rmSync(recording.path, { force: true });
          if (!isOverLimit()) break;
        }
        return;
      }
      const cutoff = new Date(`${today()}T00:00:00`);
      cutoff.setDate(cutoff.getDate() - (settings.retentionDays - 1));
      for (const day of fs.readdirSync(root(), { withFileTypes: true })) {
        if (!day.isDirectory() || !DAY_FOLDER.test(day.name) || new Date(`${day.name}T00:00:00`) >= cutoff) continue;
        const dayFolder = path.join(root(), day.name);
        for (const recording of fs.readdirSync(dayFolder, { withFileTypes: true })) {
          if (!recording.isFile() || !isRawRecordingName(recording.name)) continue;
          const filePath = path.join(dayFolder, recording.name);
          if (!isFavorite(filePath)) fs.rmSync(filePath, { force: true });
        }
      }
    },
    recentRecordings() {
      const dayFolder = path.join(root(), today());
      if (!fs.existsSync(dayFolder)) return [];
      return fs.readdirSync(dayFolder, { withFileTypes: true }).filter(item => item.isFile() && VIDEO_EXTENSION.test(item.name))
        .map(item => { const filePath = path.join(dayFolder, item.name); const stat = fs.statSync(filePath); return enrich({ name: item.name, path: filePath, bytes: stat.size, modified: stat.mtime.toISOString(), kind: /^Replay(?:[ _-]|$)/i.test(item.name) ? 'replay' : 'recording', favorite: isFavorite(filePath) }); })
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.modified.localeCompare(a.modified)).slice(0, 24);
    },
    archivedRecordings() {
      if (!fs.existsSync(root())) return [];
      const recordings = [];
      for (const day of fs.readdirSync(root(), { withFileTypes: true })) {
        if (!day.isDirectory() || !DAY_FOLDER.test(day.name) || day.name === today()) continue;
        const dayFolder = path.join(root(), day.name);
        for (const item of fs.readdirSync(dayFolder, { withFileTypes: true })) {
          if (!item.isFile() || !VIDEO_EXTENSION.test(item.name)) continue;
          const filePath = path.join(dayFolder, item.name); const stat = fs.statSync(filePath);
          recordings.push(enrich({ name: item.name, path: filePath, bytes: stat.size, modified: stat.mtime.toISOString(), day: day.name, kind: /^Replay(?:[ _-]|$)/i.test(item.name) ? 'replay' : 'recording', favorite: isFavorite(filePath) }));
        }
      }
      return recordings.sort((a, b) => b.day.localeCompare(a.day) || b.modified.localeCompare(a.modified));
    },
    validatePath(filePath) {
      const target = path.resolve(String(filePath || ''));
      const relative = path.relative(root(), target);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error('Recording no longer exists.');
      return target;
    }
  };
}

module.exports = { createRecordingLibrary, isRawRecordingName };
