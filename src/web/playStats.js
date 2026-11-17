// playStats.js – lightweight listening statistics per guild (plays, minutes, top tracks, top DJs, 30-day chart)
const path = require('path');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'play-stats.json');
const DAYS = 30;
const TOP_MAX = 150;
let data = null;
let timer = null;

function load() {
  if (data) return data;
  const res = readJson(FILE);
  data = res.ok && res.data && typeof res.data === 'object' ? res.data : {};
  return data;
}

function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { writeJsonAtomic(FILE, data, { backup: false }); } catch (err) {
      console.warn(`[STATS] write failed: ${err.message}`);
    }
  }, 5000);
  timer.unref?.();
}

function guildOf(queueKey) {
  const s = String(queueKey);
  if (s.startsWith('guild:')) return s.slice(6);
  const m = /^slave-(\d+)-/.exec(s);
  return m ? m[1] : null;
}

function prune(map, max) {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => (b[1].count || b[1]) - (a[1].count || a[1]));
  return Object.fromEntries(entries.slice(0, Math.floor(max * 0.8)));
}

/** Called when a track finishes (or is skipped after playing). seconds = time actually played. */
function record(queueKey, track, seconds) {
  const gid = guildOf(queueKey);
  if (!gid || !track) return;
  load();
  const g = data[gid] || (data[gid] = { plays: 0, seconds: 0, days: {}, tracks: {}, djs: {}, hours: new Array(24).fill(0) });
  const secs = Math.max(0, Math.min(Math.round(seconds || 0), 6 * 3600));
  const day = new Date().toISOString().slice(0, 10);
  g.plays++;
  g.seconds += secs;
  const d = g.days[day] || (g.days[day] = { plays: 0, seconds: 0 });
  d.plays++;
  d.seconds += secs;
  const keepDays = Object.keys(g.days).sort().slice(-DAYS);
  g.days = Object.fromEntries(keepDays.map(k => [k, g.days[k]]));
  const key = track.url || track.title;
  if (key) {
    const tr = g.tracks[key] || (g.tracks[key] = { title: track.title, thumbnail: track.thumbnail || null, count: 0 });
    tr.count++;
    tr.title = track.title || tr.title;
    g.tracks = prune(g.tracks, TOP_MAX);
  }
  const dj = track.requester?.id ? String(track.requester.id) : null;
  if (dj) {
    const e = g.djs[dj] || (g.djs[dj] = { name: track.requester.displayName || track.requester.globalName || track.requester.username || dj, count: 0 });
    e.count++;
    g.djs = prune(g.djs, TOP_MAX);
  }
  if (!Array.isArray(g.hours) || g.hours.length !== 24) g.hours = new Array(24).fill(0);
  g.hours[new Date().getUTCHours()]++;
  persist();
}

function forGuild(guildId) {
  load();
  const g = data[String(guildId)];
  if (!g) return { plays: 0, seconds: 0, days: [], topTracks: [], topDjs: [], hours: new Array(24).fill(0) };
  const days = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const k = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ day: k, ...(g.days[k] || { plays: 0, seconds: 0 }) });
  }
  return {
    plays: g.plays,
    seconds: g.seconds,
    days,
    topTracks: Object.entries(g.tracks).map(([url, v]) => ({ url, ...v })).sort((a, b) => b.count - a.count).slice(0, 15),
    topDjs: Object.entries(g.djs).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.count - a.count).slice(0, 10),
    hours: g.hours || new Array(24).fill(0),
  };
}

function totals() {
  load();
  const today = new Date().toISOString().slice(0, 10);
  let plays = 0;
  let seconds = 0;
  let todayPlays = 0;
  let todaySeconds = 0;
  for (const g of Object.values(data)) {
    plays += g.plays || 0;
    seconds += g.seconds || 0;
    todayPlays += g.days?.[today]?.plays || 0;
    todaySeconds += g.days?.[today]?.seconds || 0;
  }
  return { plays, seconds, todayPlays, todaySeconds };
}

function flush() {
  if (!data) return;
  if (timer) { clearTimeout(timer); timer = null; }
  try { writeJsonAtomic(FILE, data, { backup: false }); } catch { /* ignore */ }
}

module.exports = { record, forGuild, totals, flush, guildOf };
