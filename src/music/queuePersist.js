// queuePersist.js – keep the playing song + queue across a restart/deploy.
// Saved every 15 s and on shutdown; restored at boot before the bots rejoin voice. When a bot rejoins and
// MusicManager.rebindPlayer() sees queue.current, it resumes the song at the saved position (startSec).
const path = require('path');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'queue-snapshot.json');
const MAX_AGE_MS = 10 * 60_000; // older snapshots are ignored (long outage: do not surprise the room)
const MAX_TRACKS = 200;
const ORPHAN_MS = 3 * 60_000; // restored queue whose bot never rejoined -> cleared
let timer = null;

/** Plain copy of a track: drop private (_x) keys, functions and non-plain values. */
function cleanTrack(t) {
  if (!t || typeof t !== 'object' || !t.url) return null;
  return JSON.parse(JSON.stringify(t, (k, v) => {
    if (k.startsWith('_') || typeof v === 'function') return undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) return undefined;
    return v;
  }));
}

/** Snapshot of all queues that have something to resume. Pure given MusicManager. */
function snapshot(MM, now = Date.now()) {
  const queues = {};
  for (const [key, q] of MM.listQueues()) {
    if (!q?.current && !q?.tracks?.length) continue;
    let pos = 0;
    try { pos = Math.max(0, Math.floor(MM.getPlaybackPosition(q) || 0)); } catch { /* ignore */ }
    const autoDj = q.autoDj?.enabled ? cleanTrack({ url: 'x', ...q.autoDj }) : null;
    if (autoDj) delete autoDj.url;
    queues[key] = {
      current: cleanTrack(q.current),
      positionSec: pos,
      tracks: (q.tracks || []).slice(0, MAX_TRACKS).map(cleanTrack).filter(Boolean),
      history: (q.history || []).slice(0, 20).map(cleanTrack).filter(Boolean),
      voiceChannelId: q.voiceChannelId || null,
      textChannelId: q.textChannel?.id || null,
      volume: q.volume ?? 100,
      loop: q.loop || 'none',
      activeFilter: q.activeFilter || 'none',
      autoDj,
    };
  }
  return { savedAt: now, queues };
}

function save(MM) {
  try {
    writeJsonAtomic(FILE, snapshot(MM), { backup: false });
  } catch (err) {
    console.warn(`[MUSIC] queue snapshot save failed: ${err.message}`);
  }
}

/**
 * Fill MusicManager queues from the snapshot (call once at boot, before voice joins).
 * isAllowed(guildId) lets the caller drop servers whose subscription ended.
 * Returns the restored keys.
 */
function restore(MM, { isAllowed = () => true, guildIdOf = () => null, now = Date.now(), data = null } = {}) {
  let snap = data;
  if (!snap) {
    const res = readJson(FILE);
    if (!res.ok || !res.data) return [];
    snap = res.data;
  }
  if (!snap.savedAt || now - snap.savedAt > MAX_AGE_MS) {
    if (snap.savedAt) console.log(`[MUSIC] queue snapshot too old (${Math.round((now - snap.savedAt) / 60000)} min) — not restored`);
    return [];
  }
  const restored = [];
  for (const [key, s] of Object.entries(snap.queues || {})) {
    const gid = guildIdOf(key);
    if (gid && !isAllowed(gid)) continue;
    if (!s.current && !s.tracks?.length) continue;
    const q = MM.getQueue(key);
    if (q.current || q.tracks?.length) continue; // live state wins
    // Resume where it was (not where it "would be" after the downtime).
    const pos = s.positionSec || 0;
    if (s.current) q.current = { ...s.current, startedAt: now - pos * 1000, pausedAt: null };
    q.tracks = s.tracks || [];
    if (Array.isArray(s.history) && s.history.length && !(q.history || []).length) q.history = s.history;
    if (s.voiceChannelId && !q.voiceChannelId) q.voiceChannelId = s.voiceChannelId;
    q.volume = s.volume ?? q.volume;
    q.loop = s.loop || q.loop;
    q.activeFilter = s.activeFilter || q.activeFilter;
    if (s.autoDj) q.autoDj = { ...(q.autoDj || {}), ...s.autoDj, enabled: true };
    q._textChannelId = s.textChannelId || null;
    q._restoredAt = now;
    restored.push(key);
  }
  if (restored.length) console.log(`[MUSIC] restored ${restored.length} queue(s) from snapshot: ${restored.join(', ')}`);
  return restored;
}

/** Restored queues whose bot never came back: clear them so the dashboard does not show ghosts. */
function clearOrphans(MM, now = Date.now()) {
  const cleared = [];
  for (const [key, q] of MM.listQueues()) {
    if (!q._restoredAt || q.player || now - q._restoredAt < ORPHAN_MS) continue;
    q.current = null;
    q.tracks = [];
    q._restoredAt = null;
    cleared.push(key);
  }
  if (cleared.length) console.log(`[MUSIC] cleared ${cleared.length} restored queue(s) with no voice: ${cleared.join(', ')}`);
  return cleared;
}

/**
 * Once a restored queue has its bot back in voice, re-attach its chat channel (via resolveChannel(key, id))
 * and post the now-playing panel again.
 */
function attachChannels(MM, resolveChannel) {
  for (const [key, q] of MM.listQueues()) {
    if (!q._restoredAt || !q.player || q.textChannel || !q._textChannelId) continue;
    let ch = null;
    try { ch = resolveChannel(key, q._textChannelId); } catch { /* ignore */ }
    q._textChannelId = null;
    if (!ch?.isTextBased?.()) continue;
    q.textChannel = ch;
    if (ch.guild) q.guild = ch.guild;
    if (q.current) MM.sendNowPlaying(key, ch.guild).catch(() => {});
  }
}

function start(MM, { resolveChannel = () => null } = {}) {
  if (timer) return;
  timer = setInterval(() => { save(MM); attachChannels(MM, resolveChannel); clearOrphans(MM); }, 15_000);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { snapshot, save, restore, clearOrphans, attachChannels, start, stop, cleanTrack, FILE, MAX_AGE_MS };
