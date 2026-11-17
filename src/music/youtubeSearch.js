// youtubeSearch.js – search via yt-search; playlists via yt-dlp (YouTube HTML breaks yt-search lists)

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const yts = require('yt-search');
const { resolveYtdlpBinary } = require('./ytdlpPath');
const { ytdlpCliPrefix } = require('./ytdlpOptions');

const execFileAsync = promisify(execFile);

const PLAYLIST_MAX = Math.max(
  0,
  parseInt(process.env.YOUTUBE_PLAYLIST_MAX_TRACKS || '50', 10) || 0,
);
const PLAYLIST_BOOTSTRAP = Math.max(
  1,
  parseInt(process.env.YOUTUBE_PLAYLIST_BOOTSTRAP || '8', 10) || 8,
);
const PLAYLIST_CACHE_MS = Math.max(
  60_000,
  parseInt(process.env.YOUTUBE_PLAYLIST_CACHE_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000,
);
const playlistCache = new Map();
/** A hung yt-dlp (network stall) must not block search/playlist forever. */
const YTDLP_TIMEOUT_MS = Math.max(10_000, parseInt(process.env.YTDLP_TIMEOUT_MS || '45000', 10) || 45_000);
/** Full playlists (hundreds of entries) legitimately take longer. */
const YTDLP_PLAYLIST_TIMEOUT_MS = Math.max(YTDLP_TIMEOUT_MS, 120_000);
const YTS_TIMEOUT_MS = 15_000;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    }),
  ]);
}

function cachePlaylist(key, list) {
  const now = Date.now();
  for (const [k, v] of playlistCache) {
    if (now >= v.expires) playlistCache.delete(k);
  }
  while (playlistCache.size > 200) {
    playlistCache.delete(playlistCache.keys().next().value);
  }
  playlistCache.set(key, { list, expires: now + PLAYLIST_CACHE_MS });
}

function isPlaylistRequest(queryOrOpts) {
  return typeof queryOrOpts === 'object' && Boolean(queryOrOpts?.listId);
}

function playlistCacheKey(listId, videoId) {
  return `${listId}:${videoId || ''}`;
}

function mapYtdlpEntry(entry) {
  const videoId = entry.id || entry.url?.match(/[?&]v=([^&]+)/)?.[1];
  const url = entry.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
  const thumb = entry.thumbnails?.[0]?.url
    || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
  return {
    videoId,
    url,
    title: entry.title || '',
    thumbnail: thumb,
    image: thumb,
    duration: typeof entry.duration === 'number' ? entry.duration : 0,
    author: {
      name: entry.uploader || entry.channel || '',
      url: entry.channel_url || entry.uploader_url || '',
    },
    views: entry.view_count || 0,
  };
}

function isYoutubeVideoEntry(entry) {
  if (!entry?.title) return false;
  const id = entry.id || entry.url?.match(/[?&]v=([^&]+)/)?.[1];
  if (!id) return false;
  if (/^PL[A-Za-z0-9_-]+$/i.test(id) || /^RD/i.test(id)) return false;
  if (entry.ie_key && entry.ie_key !== 'Youtube') return false;
  return /youtube/i.test(entry.url || '') || id.length === 11;
}

function playlistYtdlpUrl(listId, videoId = null) {
  const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
  return videoId
    ? `https://www.youtube.com/watch?v=${videoId}&list=${listId}`
    : playlistUrl;
}

async function runYtdlp(args, { timeoutMs = YTDLP_TIMEOUT_MS } = {}) {
  const { stdout } = await execFileAsync(resolveYtdlpBinary(), [...ytdlpCliPrefix(), ...args], {
    maxBuffer: 50 * 1024 * 1024,
    windowsHide: true,
    timeout: timeoutMs || YTDLP_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  return JSON.parse(stdout);
}

async function searchViaYtdlp(query, limit = 10) {
  const data = await runYtdlp([
    `ytsearch${limit}:${query}`,
    '--flat-playlist',
    '--dump-single-json',
    '--ignore-errors',
    '--no-warnings',
  ]);
  const videos = (data.entries || [])
    .filter(isYoutubeVideoEntry)
    .map(mapYtdlpEntry);

  return { videos, playlists: [], channels: [], live: [] };
}

async function playlistViaYtdlp(listId, videoId = null, { endLimit = null } = {}) {
  const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
  const url = playlistYtdlpUrl(listId, videoId);
  const args = [
    url,
    '--flat-playlist',
    '--dump-single-json',
    '--ignore-errors',
    '--no-warnings',
  ];
  const cap = endLimit ?? (PLAYLIST_MAX > 0 ? PLAYLIST_MAX : 0);
  if (cap > 0) args.push('--playlist-end', String(cap));

  const data = await runYtdlp(args, { timeoutMs: endLimit ? YTDLP_TIMEOUT_MS : YTDLP_PLAYLIST_TIMEOUT_MS });
  const videos = (data.entries || [])
    .filter(isYoutubeVideoEntry)
    .map(mapYtdlpEntry)
    .filter(v => v.videoId);

  if (!videos.length) {
    throw new Error('playlist error: unviewable');
  }

  return {
    title: data.title || data.playlist_title || 'YouTube Playlist',
    listId,
    url: data.webpage_url || playlistUrl,
    size: videos.length,
    videos,
  };
}

/** Title only — one fast yt-dlp call for the URL-choice prompt. */
async function fetchPlaylistMeta(listId, videoId = null) {
  const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
  const data = await runYtdlp([
    playlistYtdlpUrl(listId, videoId),
    '--flat-playlist',
    '--dump-single-json',
    '--ignore-errors',
    '--no-warnings',
    '--playlist-end', '1',
  ]);
  return {
    title: data.title || data.playlist_title || 'YouTube Playlist',
    listId,
    url: data.webpage_url || playlistUrl,
  };
}

async function fetchYouTubePlaylist(listId, videoId = null, { useCache = true, endLimit = null } = {}) {
  const key = playlistCacheKey(listId, videoId);
  if (useCache && !endLimit) {
    const hit = playlistCache.get(key);
    if (hit && Date.now() < hit.expires) return hit.list;
  }
  const list = await playlistViaYtdlp(listId, videoId, { endLimit });
  if (!endLimit) cachePlaylist(key, list);
  return list;
}

/** Fast first chunk, then load full list in background (callback receives full list). */
async function fetchYouTubePlaylistFast(listId, videoId = null, onFullLoaded = null) {
  const key = playlistCacheKey(listId, videoId);
  const hit = playlistCache.get(key);
  if (hit && Date.now() < hit.expires) return hit.list;

  const bootstrapEnd = PLAYLIST_MAX > 0
    ? Math.min(PLAYLIST_BOOTSTRAP, PLAYLIST_MAX)
    : PLAYLIST_BOOTSTRAP;
  const quick = await playlistViaYtdlp(listId, videoId, { endLimit: bootstrapEnd });

  const needsMore = PLAYLIST_MAX === 0 || PLAYLIST_MAX > bootstrapEnd;
  if (needsMore && typeof onFullLoaded === 'function') {
    void fetchYouTubePlaylist(listId, videoId, { useCache: false })
      .then((full) => {
        cachePlaylist(key, full);
        onFullLoaded(full);
      })
      .catch(() => {});
  } else {
    cachePlaylist(key, quick);
  }

  return quick;
}

async function youtubeSearch(queryOrOpts) {
  if (isPlaylistRequest(queryOrOpts)) {
    return fetchYouTubePlaylist(
      queryOrOpts.listId,
      queryOrOpts.videoId || null,
    );
  }

  try {
    return await withTimeout(yts(queryOrOpts), YTS_TIMEOUT_MS, 'yt-search');
  } catch (err) {
    if (typeof queryOrOpts === 'string') {
      return searchViaYtdlp(queryOrOpts);
    }
    throw err;
  }
}

youtubeSearch.fetchPlaylistMeta = fetchPlaylistMeta;
youtubeSearch.fetchYouTubePlaylist = fetchYouTubePlaylist;
youtubeSearch.fetchYouTubePlaylistFast = fetchYouTubePlaylistFast;
youtubeSearch.withTimeout = withTimeout;
youtubeSearch.YTDLP_TIMEOUT_MS = YTDLP_TIMEOUT_MS;

module.exports = youtubeSearch;
