// linkMeta.js – normalize + metadata for non-YouTube media links (via yt-dlp)

const { exec } = require('youtube-dl-exec');
const { ytdlpExecOptions } = require('./ytdlpOptions');

const PLATFORM_LABELS = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  bandcamp: 'Bandcamp',
  mixcloud: 'Mixcloud',
  external: 'Link',
};

function normalizeMediaUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'music.youtube.com' || host === 'm.youtube.com') {
      u.hostname = 'www.youtube.com';
      return u.toString();
    }
  } catch { /* ignore */ }
  return url.trim();
}

const IPV4_LIKE_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function isBlockedIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  return a >= 224; // 224/4 multicast and above (reserved)
}

function ipv4FromV6Mapped(tail) {
  if (IPV4_LIKE_RE.test(tail)) return tail;
  const groups = tail.split(':');
  if (groups.length !== 2 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const hex = `${groups[0].padStart(4, '0')}${groups[1].padStart(4, '0')}`;
  if (hex.length !== 8) return null;
  const bytes = [];
  for (let i = 0; i < 8; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  return bytes.join('.');
}

function isBlockedIpv6(host) {
  if (host === '::' || host === '::1') return true; // unspecified / loopback
  if (host.startsWith('fc') || host.startsWith('fd')) return true; // fc00::/7 unique local
  const head = host.slice(0, 4);
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (host.startsWith('::ffff:')) {
    const mapped = ipv4FromV6Mapped(host.slice('::ffff:'.length));
    return mapped ? isBlockedIpv4(mapped) : true;
  }
  return false;
}

/** Synchronous SSRF guard: blocks loopback/private/link-local/metadata hosts. No DNS lookups. */
function isSafeMediaUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  if (host === '0.0.0.0') return false;
  if (host.includes(':')) return !isBlockedIpv6(host);
  if (IPV4_LIKE_RE.test(host)) return !isBlockedIpv4(host);
  return true;
}

function detectLinkPlatform(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be' || host.includes('youtube')) return 'youtube';
    if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
    if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) return 'bandcamp';
    if (host === 'mixcloud.com' || host.endsWith('.mixcloud.com')) return 'mixcloud';
    if (/^https?:\/\//i.test(url)) return 'external';
  } catch { /* ignore */ }
  return null;
}

function platformLabel(platform) {
  return PLATFORM_LABELS[platform] || PLATFORM_LABELS.external;
}

/** True when yt-dlp should resolve title/thumbnail (not plain YouTube — that uses yt-search). */
function needsYtdlpMetadata(url, videoId) {
  if (!url || videoId) return false;
  const platform = detectLinkPlatform(url);
  if (!platform || platform === 'youtube') return false;
  return true;
}

async function fetchYtdlpMetadata(url) {
  if (!isSafeMediaUrl(url)) throw new Error('Blocked media URL');
  const data = await exec(url, {
    dumpSingleJson: true,
    noPlaylist: true,
    noWarnings: true,
    skipDownload: true,
    ...ytdlpExecOptions(),
  }, { timeout: 45_000, killSignal: 'SIGKILL' });
  const info = typeof data === 'string' ? JSON.parse(data) : data;
  const rawTitle = info.title || info.track || info.fulltitle || null;
  const artist = info.artist || info.uploader || info.channel || null;
  const title = rawTitle && artist && !rawTitle.includes(artist)
    ? `${artist} — ${rawTitle}`
    : rawTitle;
  const thumbnail = info.thumbnail
    || (Array.isArray(info.thumbnails) && info.thumbnails.length
      ? info.thumbnails[info.thumbnails.length - 1]?.url
      : null);
  const durationSec = typeof info.duration === 'number' ? info.duration : 0;
  return { title, thumbnail, durationSec };
}

module.exports = {
  normalizeMediaUrl,
  detectLinkPlatform,
  platformLabel,
  needsYtdlpMetadata,
  isSafeMediaUrl,
  fetchYtdlpMetadata,
};
