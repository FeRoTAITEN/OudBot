const lyricsFinder = require('lyrics-finder');
const { logOnce } = require('../util/logger');

const LRCLIB = 'https://lrclib.net/api';
const CACHE_MAX = 200;
const HTTP_TIMEOUT_MS = 8000;
/** Hard cap per provider so a hung scraper never blocks the lyrics button. */
const PROVIDER_TIMEOUT_MS = 15_000;
const cache = new Map();

let mxmClient;
let geniusClient;

function parseTitle(title) {
  let t = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(official|video|audio|lyrics|mv|hd|4k|visualizer)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let artist = '';
  let track = t;

  const dash = t.match(/^(.+?)\s*[-–—|]\s*(.+)$/);
  if (dash) {
    artist = dash[1].trim();
    track = dash[2].trim();
  }

  const by = t.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) {
    track = by[1].trim();
    artist = by[2].trim();
  }

  return { artist, track: track || title };
}

function cacheKey(title, durationSec) {
  return `${title}|${Math.round(durationSec)}`;
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function setCached(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX) {
    cache.delete(cache.keys().next().value);
  }
}

function stripLrc(text) {
  return text
    .split('\n')
    .map(line => line.replace(/^\[[\d:.,]+\]\s*/g, '').replace(/<\d{2}:\d{2}\.\d{2}>/g, ''))
    .join('\n')
    .trim();
}

function plainFromMxm(result) {
  if (!result) return null;
  const text = result.unsynced || result.synced;
  if (!text?.trim()) return null;
  return result.unsynced ? text.trim() : stripLrc(text);
}

/** GET JSON from LRCLIB; null on timeout/network/HTTP error (never throws). */
async function lrclibJson(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: { 'User-Agent': 'OudBot/1.0' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    logOnce(`lyrics:${err.name}`, 300_000, () => console.warn(`[LYRICS] LRCLIB request failed: ${err.message}`));
    return null;
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

async function lrclibGet(track, artist, durationSec) {
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist || track,
  });
  if (durationSec > 0) params.set('duration', String(Math.round(durationSec)));

  const data = await lrclibJson(`${LRCLIB}/get?${params}`);
  if (!data || data.instrumental) return null;
  return data.plainLyrics?.trim() || null;
}

async function lrclibSearch(query) {
  const list = await lrclibJson(`${LRCLIB}/search?q=${encodeURIComponent(query)}`);
  if (!Array.isArray(list) || !list.length) return null;

  const hit = list.find(s => s.plainLyrics && !s.instrumental) || list[0];
  if (hit?.instrumental) return null;
  return hit.plainLyrics?.trim() || null;
}

async function fromLrclib(artist, track, durationSec) {
  if (artist) {
    const direct = await lrclibGet(track, artist, durationSec);
    if (direct) return direct;
  }
  return lrclibSearch(artist ? `${artist} ${track}` : track);
}

async function getMxmClient() {
  if (!mxmClient) {
    const { default: MusixmatchLyrics } = await import('@bobandbob/musixmatch-lyrics');
    mxmClient = new MusixmatchLyrics();
  }
  return mxmClient;
}

async function fromMusixmatch(artist, track, title) {
  const client = await getMxmClient();
  const queries = [
    artist ? `${artist} - ${track}` : null,
    artist ? `${artist} ${track}` : null,
    title,
    track,
  ].filter(Boolean);

  for (const query of queries) {
    const result = await client.getLrc(query);
    const text = plainFromMxm(result);
    if (text) return text;
  }
  return null;
}

function getGeniusClient() {
  if (!geniusClient) {
    const Genius = require('genius-lyrics');
    geniusClient = new Genius.Client(process.env.GENIUS_ACCESS_TOKEN || undefined);
  }
  return geniusClient;
}

async function fromGenius(artist, track, title) {
  const client = getGeniusClient();
  const queries = [
    artist ? `${artist} ${track}` : null,
    title,
    track,
  ].filter(Boolean);

  for (const query of queries) {
    const songs = await client.songs.search(query);
    const song = songs?.[0];
    if (!song) continue;
    const lyrics = await song.lyrics();
    if (lyrics?.trim()) return lyrics.trim();
  }
  return null;
}

async function fromLyricsFinder(artist, track, title) {
  if (artist) {
    const hit = await lyricsFinder(artist, track);
    if (hit?.trim()) return hit.trim();
  }
  const hit = await lyricsFinder('', title);
  return hit?.trim() || null;
}

const PROVIDERS = [
  { source: 'LRCLIB', fetch: ({ artist, track, durationSec }) => fromLrclib(artist, track, durationSec) },
  { source: 'Musixmatch', fetch: ({ artist, track, title }) => fromMusixmatch(artist, track, title) },
  { source: 'Genius', fetch: ({ artist, track, title }) => fromGenius(artist, track, title) },
  { source: 'LyricsFinder', fetch: ({ artist, track, title }) => fromLyricsFinder(artist, track, title) },
];

/**
 * @param {string} title
 * @param {number} [durationSec]
 * @returns {Promise<{ lyrics: string|null, source: string|null }>}
 */
async function findLyrics(title, durationSec = 0) {
  const key = cacheKey(title, durationSec);
  const cached = getCached(key);
  if (cached) return cached;

  const meta = { ...parseTitle(title), title, durationSec };

  for (const provider of PROVIDERS) {
    try {
      const lyrics = await withTimeout(provider.fetch(meta), PROVIDER_TIMEOUT_MS, provider.source);
      if (lyrics) {
        const hit = { lyrics, source: provider.source };
        setCached(key, hit);
        return hit;
      }
    } catch (err) {
      logOnce(`lyrics:${provider.source}:${err.message}`, 300_000, () =>
        console.warn(`[LYRICS] ${provider.source}:`, err.message));
    }
  }

  return { lyrics: null, source: null };
}

module.exports = { findLyrics, parseTitle };
