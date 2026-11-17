// streamingLinks.js – play Spotify / Apple Music / Deezer / Anghami / Tidal links by matching each track on YouTube.
// Only public metadata is read (embed pages, public APIs, page titles). Audio always comes from YouTube via yt-dlp.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const FETCH_TIMEOUT_MS = 8000;
const MAX_ITEMS = Math.max(1, parseInt(process.env.STREAMING_LINK_MAX_TRACKS || '100', 10) || 100);

const HOSTS = {
  spotify: ['open.spotify.com', 'spotify.link', 'spotify.app.link'],
  apple: ['music.apple.com', 'itunes.apple.com', 'geo.music.apple.com'],
  deezer: ['deezer.com', 'www.deezer.com', 'link.deezer.com', 'deezer.page.link'],
  anghami: ['anghami.com', 'play.anghami.com', 'open.anghami.com'],
  tidal: ['tidal.com', 'listen.tidal.com'],
};
const LABELS = { spotify: 'Spotify', apple: 'Apple Music', deezer: 'Deezer', anghami: 'Anghami', tidal: 'TIDAL' };

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function streamingPlatform(url) {
  const host = hostOf(url);
  if (!host) return null;
  for (const [platform, hosts] of Object.entries(HOSTS)) {
    if (hosts.includes(host)) return platform;
  }
  return null;
}

function isAllowedHost(url) {
  return Boolean(streamingPlatform(url));
}

async function httpGet(url, { json = false, maxBytes = 3_000_000 } = {}) {
  // Follow redirects manually so every hop stays on a known streaming host (SSRF guard).
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!isAllowedHost(current) && !/^https:\/\/(api\.deezer\.com|itunes\.apple\.com)\//.test(current)) {
      throw new Error('redirect left the streaming service');
    }
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html' }, // Anghami answers 406 to any other Accept
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > maxBytes) throw new Error('response too large');
    return { url: current, body: json ? JSON.parse(text) : text };
  }
  throw new Error('too many redirects');
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function metaContent(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');
  const m = re.exec(html) || re2.exec(html);
  return m ? decodeEntities(m[1]).trim() : null;
}

// ---------------------------------------------------------------- Spotify

function parseSpotify(url) {
  const m = /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{10,40})/.exec(url);
  return m ? { type: m[1], id: m[2] } : null;
}

async function resolveSpotify(url) {
  let ref = parseSpotify(url);
  if (!ref) {
    const r = await httpGet(url); // short link → final open.spotify.com URL
    ref = parseSpotify(r.url);
    if (!ref) throw new Error('unsupported Spotify link');
  }
  if (ref.type === 'artist') throw new Error('Spotify artist pages are not supported — send a track, album or playlist');
  const { body } = await httpGet(`https://open.spotify.com/embed/${ref.type}/${ref.id}`);
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(body);
  if (!m) throw new Error('Spotify page format changed');
  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('Spotify item not found');
  const image = entity.visualIdentity?.image?.slice?.(-1)?.[0]?.url || entity.coverArt?.sources?.[0]?.url || null;
  if (ref.type === 'track') {
    return {
      kind: 'track',
      name: entity.name || entity.title,
      image,
      items: [{
        title: entity.name || entity.title,
        artist: (entity.artists || []).map(a => a.name).join(', '),
        durationSec: Math.round((entity.duration || 0) / 1000),
        image,
      }],
    };
  }
  const items = (entity.trackList || []).slice(0, MAX_ITEMS).map(t => ({
    title: t.title,
    artist: t.subtitle || '',
    durationSec: Math.round((t.duration || 0) / 1000),
    image,
  })).filter(t => t.title);
  return { kind: ref.type, name: entity.name || entity.title, image, items };
}

// ---------------------------------------------------------------- Apple Music

async function resolveApple(url) {
  const u = new URL(url);
  const country = (/^\/([a-z]{2})\//.exec(u.pathname)?.[1]) || 'us';
  const trackId = u.searchParams.get('i');
  // /{cc}/album/{slug}/{id} or /{cc}/album/{id} (slug optional) — the id is always the last segment.
  const segs = u.pathname.split('/').filter(Boolean);
  const ti = segs.findIndex(s => s === 'album' || s === 'song' || s === 'playlist');
  const type = ti >= 0 ? segs[ti] : null;
  const last = ti >= 0 && segs.length > ti + 1 ? segs[segs.length - 1] : null;
  const id = trackId || last;
  if (!id) throw new Error('unsupported Apple Music link');

  if (type === 'playlist' || String(id).startsWith('pl.')) {
    const { body } = await httpGet(url);
    const name = metaContent(body, 'og:title') || 'Apple Music playlist';
    // Playlist pages embed the song list as schema.org JSON-LD.
    const items = [];
    for (const block of body.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || []) {
      try {
        const data = JSON.parse(block.replace(/^<script[^>]*>|<\/script>$/g, ''));
        for (const tr of data.track || []) {
          items.push({ title: tr.name, artist: tr.byArtist?.name || tr.byArtist?.[0]?.name || '', durationSec: isoDurationSec(tr.duration) });
        }
      } catch { /* ignore */ }
    }
    if (!items.length) throw new Error('Apple Music playlist is private or empty');
    return { kind: 'playlist', name, image: metaContent(body, 'og:image'), items: items.slice(0, MAX_ITEMS) };
  }

  const { body } = await httpGet(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&limit=200&country=${country}`, { json: true });
  const results = body?.results || [];
  const songs = results.filter(r => r.wrapperType === 'track' && r.kind === 'song');
  const collection = results.find(r => r.wrapperType === 'collection');
  const toItem = (r) => ({
    title: r.trackName,
    artist: r.artistName,
    durationSec: Math.round((r.trackTimeMillis || 0) / 1000),
    image: (r.artworkUrl100 || '').replace('100x100', '600x600') || null,
  });
  if (trackId || type === 'song') {
    const song = songs.find(r => String(r.trackId) === String(id)) || songs[0];
    if (!song) throw new Error('Apple Music song not found');
    return { kind: 'track', name: song.trackName, image: toItem(song).image, items: [toItem(song)] };
  }
  if (!songs.length) throw new Error('Apple Music album not found');
  return { kind: 'album', name: collection?.collectionName || songs[0].collectionName, image: toItem(songs[0]).image, items: songs.slice(0, MAX_ITEMS).map(toItem) };
}

function isoDurationSec(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(String(iso || ''));
  return m ? (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0) : 0;
}

// ---------------------------------------------------------------- Deezer

async function resolveDeezer(url) {
  let target = url;
  if (/link\.deezer\.com|deezer\.page\.link/.test(url)) target = (await httpGet(url)).url;
  const m = /deezer\.com\/(?:[a-z]{2}\/)?(track|album|playlist)\/(\d+)/.exec(target);
  if (!m) throw new Error('unsupported Deezer link');
  const [, type, id] = m;
  const toItem = (t, image) => ({ title: t.title, artist: t.artist?.name || '', durationSec: t.duration || 0, image: t.album?.cover_xl || image || null });
  if (type === 'track') {
    const { body } = await httpGet(`https://api.deezer.com/track/${id}`, { json: true });
    if (body?.error) throw new Error('Deezer track not found');
    return { kind: 'track', name: body.title, image: body.album?.cover_xl || null, items: [toItem(body)] };
  }
  const { body: info } = await httpGet(`https://api.deezer.com/${type}/${id}`, { json: true });
  if (info?.error) throw new Error(`Deezer ${type} not found`);
  const image = info.cover_xl || info.picture_xl || null;
  const { body } = await httpGet(`https://api.deezer.com/${type}/${id}/tracks?limit=${MAX_ITEMS}`, { json: true });
  return { kind: type, name: info.title, image, items: (body?.data || []).map(t => toItem(t, image)) };
}

// ---------------------------------------------------------------- Anghami / Tidal (single tracks from page titles)

async function resolveByTitle(url, platform) {
  const { body } = await httpGet(url);
  let raw = metaContent(body, 'og:title') || decodeEntities((/<title>([^<]*)<\/title>/i.exec(body) || [])[1] || '');
  raw = raw.replace(/\s*\|\s*Play on Anghami.*$/i, '').replace(/\s*(on|\|)\s*TIDAL.*$/i, '').trim();
  if (!raw) throw new Error(`${LABELS[platform]} item not found`);
  const dash = raw.split(/\s+[-–—]\s+/);
  const item = dash.length >= 2
    ? { artist: dash[0], title: dash.slice(1).join(' - ') }
    : { artist: '', title: raw };
  const dur = Number(metaContent(body, 'music:duration')) || 0;
  return { kind: 'track', name: item.title, image: metaContent(body, 'og:image'), items: [{ ...item, durationSec: dur, image: metaContent(body, 'og:image') }] };
}

async function resolveStreamingLink(url) {
  const platform = streamingPlatform(url);
  if (!platform) throw new Error('not a streaming link');
  let res;
  if (platform === 'spotify') res = await resolveSpotify(url);
  else if (platform === 'apple') res = await resolveApple(url);
  else if (platform === 'deezer') res = await resolveDeezer(url);
  else res = await resolveByTitle(url, platform);
  if (!res.items.length) throw new Error(`${LABELS[platform]} list is empty`);
  return { platform, label: LABELS[platform], ...res };
}

// ---------------------------------------------------------------- YouTube matching

const BAD_WORDS = ['live', 'cover', 'karaoke', 'instrumental', 'remix', 'slowed', 'sped up', 'reverb', '8d', 'nightcore', 'lyrics video', 'reaction', 'تلاوة'];

function norm(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function scoreVideo(v, item) {
  const vt = norm(v.title);
  const want = norm(item.title);
  const artist = norm(item.artist.split(',')[0]);
  let score = 0;
  for (const w of want.split(' ')) if (w && vt.includes(w)) score += 2;
  if (artist && (vt.includes(artist) || norm(v.author?.name).includes(artist))) score += 4;
  if (/ - topic$/i.test(v.author?.name || '')) score += 3;
  if (/official (audio|video|music video)|audio/i.test(v.title)) score += 2;
  const src = norm(`${item.title} ${item.artist}`);
  for (const bad of BAD_WORDS) if (vt.includes(bad) && !src.includes(bad)) score -= 5;
  const dur = v.seconds || v.duration?.seconds || 0;
  if (item.durationSec && dur) {
    const diff = Math.abs(dur - item.durationSec);
    if (diff <= 3) score += 5;
    else if (diff <= 10) score += 2;
    else if (diff > 60) score -= 6;
  } else if (dur > 900) {
    score -= 6; // unknown source length: avoid hour-long mixes / compilations
  }
  return score;
}

/** Find the best YouTube video for a streaming item. `search` = youtubeSearch (yt-search API). */
async function matchOnYouTube(item, search) {
  const q = [item.artist.split(',')[0], item.title].filter(Boolean).join(' - ');
  const res = await search(q);
  const videos = (res?.videos || []).slice(0, 8);
  if (!videos.length) return null;
  let best = videos[0];
  let bestScore = -Infinity;
  for (const v of videos) {
    const s = scoreVideo(v, item);
    if (s > bestScore) { best = v; bestScore = s; }
  }
  return best;
}

/**
 * Resolve a streaming link and feed YouTube matches into a queue: the first match is delivered
 * immediately (so playback starts in ~2 s), the rest are matched in small parallel batches, in order.
 * @param {object} o
 * @param {string} o.url
 * @param {Function} o.search      youtubeSearch (yt-search compatible)
 * @param {Function} o.makeTrack   (video, item) => queue track
 * @param {Function} o.enqueue     (tracks[]) => number added
 * @param {Function} [o.onFirst]   async (resolved, firstTrack) => void
 * @param {Function} [o.isCancelled] () => boolean   stop early (queue stopped / bot left)
 */
async function enqueueStreamingLink({ url, search, makeTrack, enqueue, onFirst = null, isCancelled = () => false, concurrency = 4 }) {
  const res = await resolveStreamingLink(url);
  const items = res.items;
  let ok = 0;
  let missed = 0;
  let i = 0;

  // First playable match (skip up to 3 unmatched items).
  let first = null;
  while (i < items.length && i < 3 && !first) {
    const v = await matchOnYouTube(items[i], search).catch(() => null);
    i++;
    if (v) first = makeTrack(v, items[i - 1]);
    else missed++;
  }
  if (!first) {
    const err = new Error(`no YouTube match for "${items[0].title}"`);
    err.code = 'NO_MATCH';
    throw err;
  }
  ok += enqueue([first]);
  if (onFirst) await onFirst(res, first);

  for (; i < items.length; i += concurrency) {
    if (isCancelled()) break;
    const batch = items.slice(i, i + concurrency);
    const videos = await Promise.all(batch.map(item => matchOnYouTube(item, search).catch(() => null)));
    const tracks = [];
    videos.forEach((v, j) => {
      if (v) tracks.push(makeTrack(v, batch[j]));
      else missed++;
    });
    if (tracks.length && !isCancelled()) ok += enqueue(tracks);
  }
  return { ...res, ok, missed, total: items.length };
}

function displayTitle(item) {
  const artist = String(item.artist || '').split(',')[0].trim();
  return artist && !item.title.toLowerCase().includes(artist.toLowerCase()) ? `${artist} - ${item.title}` : item.title;
}

module.exports = {
  enqueueStreamingLink,
  displayTitle,
  streamingPlatform,
  resolveStreamingLink,
  matchOnYouTube,
  scoreVideo,
  LABELS,
};
