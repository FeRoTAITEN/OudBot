const { readStored, writeStored } = require('./musicStoragePath');

const KIND = 'playlists';

function readAll(queueKey) {
  const raw = readStored(KIND, queueKey, {});
  return migrate(raw);
}

function migrate(data) {
  const out = {};
  if (data._default) out._default = data._default;
  for (const [key, val] of Object.entries(data)) {
    if (key === '_default') continue;
    if (Array.isArray(val)) {
      out[key] = {
        displayName: key.replace(/_/g, ' '),
        tracks: val,
        savedAt: null,
      };
    } else if (val?.tracks) {
      out[key] = val;
    }
  }
  return out;
}

function writeAll(queueKey, data) {
  writeStored(KIND, queueKey, data);
}

function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, '_');
}

function stripTrack(track) {
  return {
    title: track.title,
    url: track.url,
    thumbnail: track.thumbnail || '',
    durationSec: track.durationSec || 0,
  };
}

function save(queueKey, displayName, tracks) {
  const key = normalizeName(displayName);
  const all = readAll(queueKey);
  all[key] = {
    displayName: String(displayName).trim(),
    tracks: tracks.map(stripTrack),
    savedAt: new Date().toISOString(),
  };
  if (!all._default) all._default = key;
  writeAll(queueKey, all);
  return { key, displayName: all[key].displayName, count: all[key].tracks.length };
}

function load(queueKey, name) {
  const key = normalizeName(name);
  const entry = readAll(queueKey)[key];
  if (!entry) return null;
  return entry.tracks ?? null;
}

function getEntry(queueKey, name) {
  const key = normalizeName(name);
  return readAll(queueKey)[key] ?? null;
}

function getDefault(queueKey) {
  return readAll(queueKey)._default ?? null;
}

function setDefault(queueKey, name) {
  const key = normalizeName(name);
  const all = readAll(queueKey);
  if (!all[key]) return false;
  all._default = key;
  writeAll(queueKey, all);
  return all[key].displayName;
}

function list(queueKey) {
  return Object.entries(readAll(queueKey))
    .filter(([key]) => key !== '_default')
    .map(([key, entry]) => ({
    key,
    displayName: entry.displayName || key,
    count: entry.tracks?.length ?? 0,
    savedAt: entry.savedAt,
    preview: (entry.tracks || []).slice(0, 3).map(t => t.title),
  }));
}

function remove(queueKey, name) {
  const key = normalizeName(name);
  const all = readAll(queueKey);
  if (!all[key]) return false;
  delete all[key];
  if (all._default === key) {
    const remaining = Object.keys(all).filter(k => k !== '_default');
    all._default = remaining[0] ?? null;
    if (!all._default) delete all._default;
  }
  writeAll(queueKey, all);
  return true;
}

/** @param index 1-based track number */
function removeTrack(queueKey, name, index) {
  const key = normalizeName(name);
  const all = readAll(queueKey);
  const entry = all[key];
  if (!entry?.tracks?.length) return null;

  const i = index - 1;
  if (i < 0 || i >= entry.tracks.length) return null;

  const removed = entry.tracks.splice(i, 1)[0];
  const displayName = entry.displayName;

  if (!entry.tracks.length) {
    delete all[key];
    if (all._default === key) {
      const remaining = Object.keys(all).filter(k => k !== '_default');
      all._default = remaining[0] ?? null;
      if (!all._default) delete all._default;
    }
  }

  writeAll(queueKey, all);
  return {
    removed,
    displayName,
    remaining: entry.tracks.length,
    playlistDeleted: !all[key],
  };
}

function clearAll(queueKey) {
  writeAll(queueKey, {});
  return true;
}

module.exports = {
  save,
  load,
  list,
  remove,
  removeTrack,
  clearAll,
  getEntry,
  getDefault,
  setDefault,
  normalizeName,
};
