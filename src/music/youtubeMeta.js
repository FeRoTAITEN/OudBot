// youtubeMeta.js – video id, thumbnail fallback, metadata enrichment

const yts = require('./youtubeSearch');
const {
  normalizeMediaUrl,
  detectLinkPlatform,
  platformLabel,
  needsYtdlpMetadata,
  fetchYtdlpMetadata,
} = require('./linkMeta');

const META_CACHE_MS = Math.max(
  60_000,
  parseInt(process.env.MUSIC_META_CACHE_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000,
);
const META_CACHE_MAX = Math.max(
  50,
  parseInt(process.env.MUSIC_META_CACHE_MAX || '500', 10) || 500,
);
const metaCache = new Map();

function metaCacheKey(url, videoId) {
  if (videoId) return `yt:${videoId}`;
  const normalized = normalizeMediaUrl(url);
  return normalized ? `url:${normalized}` : null;
}

function getCachedMeta(key) {
  if (!key) return null;
  const hit = metaCache.get(key);
  if (!hit || Date.now() >= hit.expires) {
    if (hit) metaCache.delete(key);
    return null;
  }
  return hit.data;
}

function setCachedMeta(key, data) {
  if (!key || !data) return;
  if (metaCache.size >= META_CACHE_MAX) {
    const oldest = metaCache.keys().next().value;
    if (oldest) metaCache.delete(oldest);
  }
  metaCache.set(key, { data: { ...data }, expires: Date.now() + META_CACHE_MS });
}

function applyCachedMeta(out, cached, { needsTitle, needsThumb, needsDuration }) {
  if (needsTitle && cached.title) out.title = cached.title;
  if (needsThumb && cached.thumbnail) out.thumbnail = cached.thumbnail;
  if (needsDuration && cached.durationSec) out.durationSec = cached.durationSec;
}

/** YouTube auto Mix / Radio list IDs — usually unviewable as playlists. */
function isYouTubeMixList(listId) {
  if (!listId) return false;
  return /^(RD|OLAK|RDMM|RDCLAK|RDEM|FLRD|LL|LM|WL|RDCM)/i.test(listId);
}

function parseYouTubeLink(url) {
  const result = { videoId: null, listId: null, isPlaylistPage: false };
  if (!url) return result;
  try {
    const u = new URL(url);
    result.videoId = extractVideoId(url);
    result.listId = u.searchParams.get('list');
    result.isPlaylistPage = /\/playlist\b/i.test(u.pathname);
  } catch { /* ignore */ }
  return result;
}

function extractVideoId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return id || null;
    }
    if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(?:embed|v|shorts|live)\/([^/?]+)/);
      if (m?.[1]) return m[1];
    }
  } catch { /* ignore */ }
  return null;
}

function defaultThumbnail(videoId) {
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';
}

function titleLooksLikeUrl(title, url) {
  if (!title) return true;
  if (title === url) return true;
  return /^https?:\/\//i.test(title);
}

function parseDurationToSec(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  if (d.seconds) return d.seconds;
  const ts = d.timestamp || d;
  if (typeof ts !== 'string') return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function pickThumbnail(info, videoId) {
  return info?.thumbnail
    || info?.image
    || info?.thumbnails?.[0]?.url
    || defaultThumbnail(videoId);
}

/** Fill missing title / thumbnail / duration before playback or display. */
async function resolveTrackMetadata(track) {
  if (!track?.url) return track;
  const url = normalizeMediaUrl(track.url);
  const out = { ...track, url };
  const videoId = extractVideoId(url);

  const needsTitle = titleLooksLikeUrl(out.title, url);
  const needsThumb = !out.thumbnail;
  const needsDuration = !out.durationSec;

  if (!needsTitle && !needsThumb && !needsDuration) return out;

  const cacheKey = metaCacheKey(url, videoId);
  const cached = getCachedMeta(cacheKey);
  if (cached) {
    applyCachedMeta(out, cached, { needsTitle, needsThumb, needsDuration });
    if (!needsTitle || !titleLooksLikeUrl(out.title, url)) {
      if (!needsThumb || out.thumbnail) {
        if (!needsDuration || out.durationSec) return out;
      }
    }
  }

  if (videoId) {
    if (needsThumb && !out.thumbnail) out.thumbnail = defaultThumbnail(videoId);
    try {
      const info = await yts.withTimeout(yts({ videoId }), 10_000, 'yt-search meta');
      if (info) {
        if (needsTitle && info.title) out.title = info.title;
        if (info.thumbnail || info.image) out.thumbnail = pickThumbnail(info, videoId);
        if (needsDuration) out.durationSec = parseDurationToSec(info.duration);
      }
    } catch { /* keep fallbacks */ }
    if (needsTitle && titleLooksLikeUrl(out.title, url)) {
      out.title = `YouTube · ${videoId}`;
    }
    setCachedMeta(cacheKey, {
      title: out.title,
      thumbnail: out.thumbnail,
      durationSec: out.durationSec || 0,
    });
    return out;
  }

  if (needsYtdlpMetadata(url, videoId)) {
    try {
      const info = await fetchYtdlpMetadata(url);
      if (needsTitle && info.title) out.title = info.title;
      if (needsThumb && info.thumbnail) out.thumbnail = info.thumbnail;
      if (needsDuration && info.durationSec) out.durationSec = info.durationSec;
    } catch { /* playback may still work */ }
    setCachedMeta(cacheKey, {
      title: out.title,
      thumbnail: out.thumbnail,
      durationSec: out.durationSec || 0,
    });
  }

  if (needsTitle && titleLooksLikeUrl(out.title, url)) {
    const platform = detectLinkPlatform(url);
    out.title = platform ? `${platformLabel(platform)} track` : 'Unknown track';
  }
  return out;
}

function displayTrackTitle(track) {
  const title = track?.title?.trim();
  const url = track?.url ? normalizeMediaUrl(track.url) : null;
  if (!title || titleLooksLikeUrl(title, url)) {
    const id = extractVideoId(url);
    if (id) return `YouTube · ${id}`;
    const platform = detectLinkPlatform(url);
    return platform ? `${platformLabel(platform)} track` : 'Unknown track';
  }
  return title.replace(/[`[\]]/g, '');
}

module.exports = {
  isYouTubeMixList,
  parseYouTubeLink,
  extractVideoId,
  defaultThumbnail,
  pickThumbnail,
  resolveTrackMetadata,
  displayTrackTitle,
  titleLooksLikeUrl,
  normalizeMediaUrl,
  detectLinkPlatform,
};
