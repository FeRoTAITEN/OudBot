// guildPerms.js – T25: per-server member permission settings (set by server admins in the dashboard).
const path = require('path');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'guild-perms.json');
const ID_RE = /^\d{17,20}$/;

const DEFAULTS = Object.freeze({
  djRoleIds: [], // empty -> a role named "DJ" counts
  djUserIds: [],
  bannedUserIds: [],
  listenerCanAdd: true,
  listenerVoteSkip: true,
  allowLinks: true,
  playPerMin: 5,
  maxTrackMin: 0, // 0 = no limit
  // T69 (review D2)
  djOnly: false, // only DJs and server admins control the music
  maxQueuedPerMember: 0, // songs one member may have waiting in the queue, 0 = no limit
  listenerMaxVolume: 200, // highest volume listeners / room owners may set
  // T71 (review D3): listener pause/volume can be turned off per server (on = owner decision 2026-10-25)
  listenerCanPause: true,
  listenerCanVolume: true,
  pauseWhenEmpty: true, // pause the song when the room has been empty for 2 minutes
});
const LIMITS = { djRoleIds: 10, djUserIds: 50, bannedUserIds: 200 };

let cache = null;

function load() {
  if (cache) return cache;
  const res = readJson(FILE);
  if (res.exists && !res.ok) throw new Error('guild-perms.json is unreadable — refusing to overwrite it');
  cache = res.exists && res.data && typeof res.data === 'object' ? res.data : {};
  return cache;
}

function ids(v, max) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(String).filter(x => ID_RE.test(x)))].slice(0, max);
}

function int(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
}

/** Validated full settings (defaults filled). Unknown keys dropped. */
function normalize(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const bool = (k) => (typeof r[k] === 'boolean' ? r[k] : DEFAULTS[k]);
  return {
    djRoleIds: ids(r.djRoleIds, LIMITS.djRoleIds),
    djUserIds: ids(r.djUserIds, LIMITS.djUserIds),
    bannedUserIds: ids(r.bannedUserIds, LIMITS.bannedUserIds),
    listenerCanAdd: bool('listenerCanAdd'),
    listenerVoteSkip: bool('listenerVoteSkip'),
    allowLinks: bool('allowLinks'),
    playPerMin: int(r.playPerMin, 1, 30, DEFAULTS.playPerMin),
    maxTrackMin: int(r.maxTrackMin, 0, 600, DEFAULTS.maxTrackMin),
    djOnly: bool('djOnly'),
    maxQueuedPerMember: int(r.maxQueuedPerMember, 0, 100, DEFAULTS.maxQueuedPerMember),
    listenerMaxVolume: int(r.listenerMaxVolume, 10, 200, DEFAULTS.listenerMaxVolume),
    listenerCanPause: bool('listenerCanPause'),
    listenerCanVolume: bool('listenerCanVolume'),
    pauseWhenEmpty: bool('pauseWhenEmpty'),
  };
}

function get(guildId) {
  return normalize(load()[String(guildId)]);
}

/** Merge a partial patch, validate, persist. Returns the saved settings. */
function set(guildId, patch) {
  const gid = String(guildId);
  if (!ID_RE.test(gid)) throw new Error('bad guild id');
  const all = load();
  const next = normalize({ ...get(gid), ...(patch && typeof patch === 'object' ? patch : {}) });
  all[gid] = next;
  writeJsonAtomic(FILE, all);
  return next;
}

module.exports = { get, set, normalize, DEFAULTS, LIMITS, _reset: () => { cache = null; } };
