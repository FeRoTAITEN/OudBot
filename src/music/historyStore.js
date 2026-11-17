const { readStored, writeStored } = require('./musicStoragePath');

const KIND = 'history';
/** Persisted per room — Discord select menus can show at most 25 at once. */
const MAX_TRACKS = 50;

function stripTrack(track) {
  return {
    title: track.title,
    url: track.url,
    thumbnail: track.thumbnail || '',
    durationSec: track.durationSec || 0,
    requester: track.requester?.name ? { name: String(track.requester.name).slice(0, 64) } : null,
    playedAt: new Date().toISOString(),
  };
}

function read(queueKey) {
  const raw = readStored(KIND, queueKey, []);
  return Array.isArray(raw) ? raw : [];
}

function write(queueKey, tracks) {
  writeStored(KIND, queueKey, tracks);
}

function list(queueKey) {
  return read(queueKey);
}

function push(queueKey, track) {
  if (!track?.url) return list(queueKey);
  const next = read(queueKey).filter(t => t.url !== track.url);
  next.unshift(stripTrack(track));
  write(queueKey, next.slice(0, MAX_TRACKS));
  return next;
}

function clear(queueKey) {
  write(queueKey, []);
  return [];
}

module.exports = { list, push, clear, MAX_TRACKS };
