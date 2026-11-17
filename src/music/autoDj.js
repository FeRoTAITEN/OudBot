// autoDj.js - Auto-DJ v2: pure pick/rotation logic, no Discord or network imports.
// MusicManager drives this ("fill the shelf" pattern).

const { extractVideoId } = require('./youtubeMeta');

// parseDurationToSec - mirrors MusicManager.parseDurationToSec (same rules, so the
// Auto-DJ "song length" filter matches what the queue will actually play). Handles a
// number, a { seconds } / { timestamp } object, or an "h:mm:ss" / "m:ss" string.
function parseDurationToSec(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value.seconds) return value.seconds;
  const ts = value.timestamp || value;
  if (typeof ts !== 'string') return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

const BANNED_TITLE = /\b(mix|mega|non.?stop|full album|playlist|compilation|\d+\s*hours?|1 hour|lyrics? video)\b/i;

function trackKey(urlOrTrack) {
  const url = typeof urlOrTrack === 'string' ? urlOrTrack : urlOrTrack?.url;
  if (!url) return null;
  const id = extractVideoId(String(url));
  return id ? `yt:${id}` : String(url).split('?')[0];
}

// current + all queued tracks, then the first `max` history entries.
function recentKeys(queue, max = 60) {
  const keys = new Set();
  const add = (item) => {
    const k = trackKey(item?.url ?? item);
    if (k) keys.add(k);
  };
  if (queue?.current) add(queue.current);
  for (const t of queue?.tracks || []) add(t);
  for (const h of (queue?.history || []).slice(0, max)) add(h);
  return keys;
}

function normalizeArtist(title, author) {
  let name = typeof author === 'string' ? author : author?.name || '';
  if (!name && typeof title === 'string') name = title.split(/\s+-\s+/)[0] || '';
  const norm = String(name).replace(/\b(official|vevo|topic)\b/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm || null;
}

function durationSecondsOk(c, minSec = 60, maxSec = 600) {
  const sec = parseDurationToSec(c?.durationSec ?? c?.duration ?? c?.lengthSeconds);
  return sec <= 0 || (sec >= minSec && sec <= maxSec);
}

function isBannedTitle(title) {
  return BANNED_TITLE.test(String(title || ''));
}

function shuffle(arr, random) {
  const rnd = random || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * candidates  = array of yt-search shaped videos { title, url, durationSec?|duration, author? }
 * recent      = Set from recentKeys(queue)
 * lastArtists = queue.autoDj.lastArtists (lowercased normalized artist strings)
 * minSec/maxSec (default 60/600: "song length" window).
 */
function pickNext(candidates, { recent, lastArtists, minSec = 60, maxSec = 600, random = Math.random } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const lastSet = new Set((lastArtists || []).filter(Boolean));
  const allowed = (c) => {
    const key = trackKey(c?.url ?? c);
    if (key && recent && recent.has(key)) return false;
    if (isBannedTitle(c?.title)) return false;
    if (!durationSecondsOk(c, minSec, maxSec)) return false;
    return true;
  };
  let pool = candidates.filter(allowed);
  if (pool.length === 0) return null;
  if (lastSet.size > 0) {
    const fresh = pool.filter((c) => !lastSet.has(normalizeArtist(typeof c === 'string' ? c : c?.title, c?.author)));
    if (fresh.length > 0) pool = fresh;
  }
  return shuffle(pool, random)[0];
}

const MOOD_QUERY_VARIATIONS = {
  'lofi hip hop': ['lofi hip hop', 'lofi beats to relax', 'chill lofi', 'lofi jazz hop', 'lofi cafe'],
  'chillhop beats': ['chillhop beats', 'chillhop to relax', 'mellow chillhop', 'chillhop cafe', 'chillhop lounge'],
  'jazz cafe': ['jazz cafe', 'smooth jazz relax', 'coffee shop jazz', 'bossa nova jazz', 'late night jazz'],
  'synthwave mix': ['synthwave mix', 'synthwave', 'retro synthwave 80s', 'outrun synthwave', 'synthwave chill'],
  'acoustic indie': ['acoustic indie', 'acoustic chill', 'indie folk acoustic', 'acoustic cafe', 'soft indie songs'],
  'electronic dance': ['electronic dance', 'chill electronic', 'deep house chill', 'downtempo electronic', 'progressive house chill'],
  'rock classics': ['rock classics', 'classic rock hits', 'oldies rock 70s 80s', 'rock radio classics', 'arena rock'],
  'pop hits': ['pop hits', 'pop radio', 'new pop songs', 'top pop songs', 'pop chart hits'],
};

function moodQueries(moodId) {
  if (typeof moodId === 'string' && MOOD_QUERY_VARIATIONS[moodId]) return MOOD_QUERY_VARIATIONS[moodId];
  const q = String(moodId || '').trim();
  if (!q) return ['lofi hip hop'];
  return [q, `${q} songs`, `${q} hits`, `${q} playlist songs`];
}

// Rotate through moodQueries(dj.query); dj = queue.autoDj (uses dj.qi and advances it).
function nextMoodQuery(dj, moodId) {
  const queries = moodQueries(moodId || dj?.query);
  const qi = Number(dj?.qi) || 0;
  const idx = ((qi % queries.length) + queries.length) % queries.length;
  if (dj) dj.qi = qi + 1;
  return queries[idx];
}

/** Last played YouTube seed: current track, else history[0]. */
function similarSeed(queue) {
  const from = (u) => extractVideoId(u);
  const id = from(queue?.current?.url) || from(queue?.history?.[0]?.url);
  return id || null;
}

function recordArtist(dj, pick) {
  const artist = normalizeArtist(typeof pick === 'string' ? pick : pick?.title, pick?.author);
  if (artist) {
    dj.lastArtists = [artist, ...(dj.lastArtists || [])].slice(0, 2);
  }
}

module.exports = {
  parseDurationToSec,
  trackKey,
  recentKeys,
  normalizeArtist,
  pickNext,
  moodQueries,
  nextMoodQuery,
  similarSeed,
  recordArtist,
};
