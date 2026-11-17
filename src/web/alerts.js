// alerts.js – self-monitoring: detects trouble early and DMs the owners (throttled). Shown on the dashboard too.
const metrics = require('./metrics');
const logBuffer = require('./logBuffer');

const CHECK_MS = 30_000;
const REPEAT_MS = 30 * 60_000;
const active = new Map(); // kind -> { kind, level, text, since, lastSent }
let timer = null;
let deps = { client: () => null, ownerIds: () => new Set(), voiceDown: () => [] };

function enabled() {
  return process.env.WEB_ALERTS !== '0';
}

// 403 / bot check, plus a player client that stopped returning audio (seen 2026-10-25 with tv_simply).
const YT_BLOCK_RE = /HTTP Error 403|Sign in to confirm|confirm you.re not a bot|Requested format is not available|page needs to be reloaded/i;

/** yt-dlp block lines (403 / bot check) in the last 15 minutes. */
function youtubeBlocks(now = Date.now()) {
  const since = now - 15 * 60_000;
  return logBuffer.query({ level: 'warn', limit: 1000 }).filter(e => e.ts >= since && YT_BLOCK_RE.test(e.text)).length;
}

function evaluate() {
  const now = Date.now();
  const m = metrics.latest();
  const found = [];
  if (m.pidsMax && m.pids != null && m.pids / m.pidsMax > 0.8) {
    found.push(['pids', 'bad', `Processes ${m.pids}/${m.pidsMax} (>80%) — new songs may fail to start`]);
  }
  if (m.memMax && m.mem / m.memMax > 0.85) {
    found.push(['mem', 'bad', `Memory ${(m.mem / 1e9).toFixed(2)} GB of ${(m.memMax / 1e9).toFixed(2)} GB (>85%)`]);
  }
  if (m.cpuLimit && m.cpu / m.cpuLimit > 85) {
    found.push(['cpu', 'warn', `CPU ${Math.round(m.cpu / m.cpuLimit)}% of the container limit`]);
  }
  if (m.loopMs > 150) {
    found.push(['loop', 'warn', `Event loop lag ${m.loopMs} ms — bot reacts slowly`]);
  }
  const errs = logBuffer.counts(10 * 60_000).error;
  if (errs >= 20) found.push(['errors', 'warn', `${errs} errors in the last 10 minutes`]);
  const yt = youtubeBlocks(now);
  if (yt >= 5) found.push(['youtube', 'warn', `YouTube blocked playback ${yt} times in 15 minutes (403 / sign-in / no formats) — check YTDLP_PLAYER_CLIENT or cookies`]);
  const client = deps.client();
  if (client && !client.isReady?.()) found.push(['gateway', 'bad', 'Main bot is not connected to Discord']);
  const down = deps.voiceDown();
  if (down.length) found.push(['voice', 'warn', `Voice not connected in ${down.length} subscribed server(s): ${down.slice(0, 5).join(', ')}`]);

  const kinds = new Set(found.map(f => f[0]));
  for (const k of [...active.keys()]) {
    if (!kinds.has(k)) {
      const a = active.get(k);
      active.delete(k);
      if (a.lastSent) void notify(`✅ Resolved: ${a.text}`);
    }
  }
  for (const [kind, level, text] of found) {
    const prev = active.get(kind);
    const a = prev || { kind, level, text, since: now, lastSent: 0 };
    a.text = text;
    a.level = level;
    active.set(kind, a);
    // Voice/CPU blips are common during reconnects: only alert when they persist for 3 minutes.
    const persistMs = kind === 'voice' || kind === 'cpu' || kind === 'loop' ? 180_000 : 60_000;
    if (now - a.since >= persistMs && now - a.lastSent >= REPEAT_MS) {
      a.lastSent = now;
      void notify(`${level === 'bad' ? '🚨' : '⚠️'} ${text}`);
    }
  }
}

async function notify(text) {
  const client = deps.client();
  if (!client?.isReady?.()) return;
  for (const id of deps.ownerIds()) {
    try {
      const user = await client.users.fetch(id);
      await user.send(`**Oud monitor** · ${text}`);
    } catch { /* DMs closed */ }
  }
}

function list() {
  return [...active.values()].map(({ kind, level, text, since }) => ({ kind, level, text, since }));
}

function start(opts = {}) {
  if (!enabled() || timer) return;
  deps = { ...deps, ...opts };
  timer = setInterval(() => {
    try { evaluate(); } catch (err) { console.warn(`[WEB] alert check failed: ${err.message}`); }
  }, CHECK_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, list, evaluate, youtubeBlocks };
