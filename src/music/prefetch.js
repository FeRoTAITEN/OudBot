// prefetch.js – extract the NEXT track's stream info (yt-dlp -J) while the current one plays.
// Playback then starts with `yt-dlp --load-info-json` and skips the extraction step
// (measured 2.9 s -> 0.5 s to first audio bytes locally; ~6.8 s cold on the VPS).
// Best effort only: any failure just means the normal (cold) path is used.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolveYtdlpBinary } = require('./ytdlpPath');
const { ytdlpCliPrefix } = require('./ytdlpOptions');
const ytdlpWorker = require('./ytdlpWorker');
const { isSafeMediaUrl } = require('./linkMeta');

const ENABLED = process.env.MUSIC_PREFETCH !== '0';
/** Signed media URLs live ~6 h; stay well inside that. */
const TTL_MS = Math.max(60_000, parseInt(process.env.MUSIC_PREFETCH_TTL_MS || '1200000', 10) || 1_200_000);
/** Global cap: each prefetch is one short python process (container PIDs limit is 512). */
const MAX_RUNNING = Math.max(1, parseInt(process.env.MUSIC_PREFETCH_CONCURRENCY || '3', 10) || 3);
const MAX_ENTRIES = 64;
const EXTRACT_TIMEOUT_MS = 45_000;
const MAX_INFO_BYTES = 8_000_000;

/** A failed / live / playlist URL is not retried for this long (the ticker calls every 20 s). */
const NEGATIVE_TTL_MS = 10 * 60_000;

const DIR = path.join(os.tmpdir(), 'oud-prefetch');
/** url -> { file, at, state: 'running' | 'ready' | 'failed', proc } */
const cache = new Map();
let running = 0;
let hits = 0;
let misses = 0;
let seq = 0;

function unlinkQuiet(file) {
  if (file) fs.unlink(file, () => {});
}

function drop(url) {
  const e = cache.get(url);
  if (!e) return;
  cache.delete(url);
  if (e.state === 'ready') unlinkQuiet(e.file);
  // A still-running extraction would hold a concurrency slot for nothing.
  if (e.state === 'running' && e.proc) {
    try { e.proc.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

function prune() {
  const now = Date.now();
  for (const [url, e] of cache) {
    if (e.state === 'ready' && now - e.at > TTL_MS) drop(url);
    else if (e.state === 'failed' && now - e.at > NEGATIVE_TTL_MS) cache.delete(url);
  }
  while (cache.size > MAX_ENTRIES) drop(cache.keys().next().value);
}

/** Start extracting `url` in the background. No-op when disabled, cached, recently failed, busy or unsafe. */
function prefetch(url) {
  if (!ENABLED || !url || !isSafeMediaUrl(url)) return;
  prune();
  if (cache.has(url) || running >= MAX_RUNNING) return;

  try { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); } catch { return; }
  const file = path.join(DIR, `${process.pid}-${Date.now()}-${seq++}.json`);
  const entry = { file, at: Date.now(), state: 'running', proc: null, worker: ytdlpWorker.stats().enabled };
  cache.set(url, entry);
  running++;

  let out = '';
  let tooBig = false;
  let done = false;
  let timer = null;
  const fail = () => {
    // Negative entry: the 20 s ticker must not respawn yt-dlp for the same URL.
    if (cache.get(url) !== entry) return;
    entry.state = 'failed';
    entry.proc = null;
    entry.at = Date.now();
  };
  const finish = (ok) => {
    if (done) return;
    done = true;
    running--;
    if (timer) clearTimeout(timer);
    entry.proc = null;
    if (cache.get(url) !== entry) { unlinkQuiet(file); return; } // dropped meanwhile
    if (!ok || tooBig) { fail(); return; }
    if (entry.worker) {
      // The worker validated (and 0600-wrote) the file itself; just claim it.
      if (!fs.existsSync(file)) { fail(); return; }
      entry.state = 'ready';
      entry.at = Date.now();
      return;
    }
    let info;
    try { info = JSON.parse(out); } catch { fail(); return; }
    out = '';
    // Live streams: manifest URLs expire fast and are not worth caching.
    if (!info || info.is_live || info._type === 'playlist') { fail(); return; }
    // 0600: the info JSON can carry cookie headers when YTDLP_COOKIES is set.
    fs.writeFile(file, JSON.stringify(info), { mode: 0o600 }, (err) => {
      if (cache.get(url) !== entry) { unlinkQuiet(file); return; }
      if (err) { unlinkQuiet(file); fail(); return; }
      entry.state = 'ready';
      entry.at = Date.now();
    });
  };

  const args = [...ytdlpCliPrefix(), '-J', '--no-playlist', '--no-warnings', url];
  if (entry.worker) {
    // Persistent worker skips the ~2s CLI startup; it writes `file` itself.
    timer = setTimeout(() => finish(false), EXTRACT_TIMEOUT_MS);
    ytdlpWorker.extract(args, file, EXTRACT_TIMEOUT_MS).then(finish, () => finish(false));
    return;
  }
  let proc;
  try {
    proc = spawn(resolveYtdlpBinary(), args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    finish(false);
    return;
  }
  entry.proc = proc;
  timer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    finish(false);
  }, EXTRACT_TIMEOUT_MS);
  timer.unref?.();
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    if (tooBig) return;
    out += chunk;
    if (out.length > MAX_INFO_BYTES) {
      tooBig = true;
      out = '';
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
  });
  proc.stdout.on('error', () => {});
  proc.on('error', () => finish(false));
  proc.on('close', (code) => finish(code === 0));
}

/**
 * Take a ready info file for `url` (removed from the cache). The caller deletes it with
 * `release(file)` once yt-dlp has finished. Returns null when nothing usable is cached.
 */
function take(url) {
  if (!ENABLED || !url) return null;
  const e = cache.get(url);
  if (!e || e.state !== 'ready') {
    // Still extracting: its result would never be used -> stop it and go cold.
    if (e?.state === 'running') drop(url);
    misses++;
    return null;
  }
  cache.delete(url);
  if (Date.now() - e.at > TTL_MS || !fs.existsSync(e.file)) { unlinkQuiet(e.file); misses++; return null; }
  hits++;
  return e.file;
}

/**
 * Like `take(url)`, but first waits up to `maxWaitMs` for an in-flight extraction to settle
 * (polls every 100 ms until the entry is ready/failed/dropped). Then returns `take(url)` —
 * on timeout `take` drops the still-running extraction and returns null, same as the cold path.
 * Never throws.
 */
async function takeWait(url, maxWaitMs = 5000) {
  const deadline = Date.now() + maxWaitMs;
  while (cache.get(url)?.state === 'running' && Date.now() < deadline) {
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  return take(url);
}

function release(file) {
  unlinkQuiet(file);
}

/**
 * Remove leftovers at load: files named with this PID (a crashed earlier run in a container
 * reuses the same PID) and any file older than the TTL (other live processes keep theirs).
 */
function cleanStale() {
  fs.readdir(DIR, (err, names) => {
    if (err) return;
    const now = Date.now();
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const full = path.join(DIR, n);
      if (n.startsWith(`${process.pid}-`)) { unlinkQuiet(full); continue; }
      fs.stat(full, (e, st) => { if (!e && now - st.mtimeMs > TTL_MS) unlinkQuiet(full); });
    }
  });
}
if (ENABLED) cleanStale();

function stats() {
  let ready = 0;
  for (const e of cache.values()) if (e.state === 'ready') ready++;
  return { enabled: ENABLED, cached: ready, running, hits, misses, worker: ytdlpWorker.stats() };
}

module.exports = { prefetch, take, takeWait, release, stats, _cache: cache };
