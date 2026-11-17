// ytdlpWorker.js -- keeps ONE python process alive (ytdlpWorker.py, T19b), so a
// cold extraction skips the ~2s yt-dlp CLI startup. One worker per process,
// JSON line protocol (see the .py file). Best effort like prefetch: every
// failure path just resolves false and the caller stays cold.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { resolveYtdlpBinary } = require('./ytdlpPath');

const WORKER_PY = path.join(__dirname, 'ytdlpWorker.py');
const MAX_INFLIGHT = 3;      // worker executes sequentially; rest just queue
const CRASH_WINDOW_MS = 10 * 60_000;
const CRASH_LIMIT = 3;      // crashes within the window -> cooldown

let proc = null;            // the ChildProcess or null
let live = false;           // proc is up (between spawn and close/error)
let seq = 0;
const queued = [];          // not-yet-sent requests, FIFO
const inflight = new Map(); // id -> request
let crashes = [];           // close/error timestamps (windowed)
let disabledUntil = 0;
let okCount = 0;
let failedCount = 0;

/** null when the worker may run, else a short reason. Re-checked per call. */
function disabledReason() {
  if (process.env.YTDLP_WORKER === '0') return 'YTDLP_WORKER=0';
  if (Date.now() < disabledUntil) return 'crash cooldown';
  if (process.platform === 'win32') return 'win32';
  let fd;
  try {
    fd = fs.openSync(resolveYtdlpBinary(), 'r');
    const head = Buffer.alloc(2);
    const n = fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    return (n === 2 && head[0] === 0x23 && head[1] === 0x21) ? null : 'not a zipapp';
  } catch { return 'no yt-dlp binary'; }
}

function stats() {
  return { enabled: disabledReason() === null, alive: live, ok: okCount, failed: failedCount };
}

function markCrash() {
  const now = Date.now();
  while (crashes.length && now - crashes[0] > CRASH_WINDOW_MS) crashes.shift();
  crashes.push(now);
  if (crashes.length >= CRASH_LIMIT) disabledUntil = now + CRASH_WINDOW_MS;
}

function settleAll(result) {
  for (const entry of queued.splice(0)) entry.settle(result);
  for (const entry of inflight.values()) entry.settle(result);
  inflight.clear();
}

function onDeath() {
  if (!proc) return; // already dead (error then close)
  live = false;
  proc = null;
  markCrash();
  settleAll(false);
}

function spawnWorker() {
  if (live) return true;
  let child;
  try {
    child = cp.spawn(
      process.platform === 'win32' ? 'python' : 'python3',
      [WORKER_PY, resolveYtdlpBinary()],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
  } catch { return false; }
  proc = child;
  live = true;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let reply;
      try { reply = JSON.parse(line); } catch { continue; }
      const entry = inflight.get(reply.id);
      if (entry) entry.settle(reply.ok === true);
    }
  });
  child.stdout.on('error', () => {});
  child.stdin.on('drain', () => pump());
  child.stdin.on('error', () => {});
  child.on('close', onDeath);
  child.on('error', onDeath);
  return true;
}

function pump() {
  if (!live) {
    // disabled (kill switch / cooldown / win32 / no zipapp) or spawn refused:
    // fail everything, never attempt a spawn here.
    if (disabledReason() !== null || !spawnWorker()) { settleAll(false); return; }
  }
  while (inflight.size < MAX_INFLIGHT && queued.length) {
    const entry = queued.shift();
    inflight.set(entry.id, entry);
    try {
      proc.stdin.write(JSON.stringify({ id: entry.id, args: entry.args, out: entry.out }) + '\n');
    } catch {
      entry.settle(false);
    }
  }
}

/**
 * Request an extraction. Resolves true iff the worker replied ok:true.
 * `args` is the yt-dlp CLI arg list (url last, same as the cold path:
 * [...ytdlpCliPrefix(), '-J', '--no-playlist', '--no-warnings', url]) and the
 * worker writes the info JSON to `outFile` itself. NEVER throws.
 */
function extract(args, outFile, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const entry = {
      id: ++seq,
      args: Array.isArray(args) ? args.map((a) => String(a)) : [String(args)],
      out: outFile ? String(outFile) : '',
      settled: false,
      timer: null,
      settle(result) {
        if (entry.settled) return;
        entry.settled = true;
        if (entry.timer) clearTimeout(entry.timer);
        const i = queued.indexOf(entry);
        if (i >= 0) queued.splice(i, 1);
        inflight.delete(entry.id);
        if (result) okCount++; else failedCount++;
        resolve(result);
      },
    };
    if (!entry.out || !entry.args.length || timeoutMs <= 0) { entry.settle(false); return; }
    entry.timer = setTimeout(() => {
      // The worker is sequential: a hung extraction would block every later one -> restart it.
      const stuck = inflight.has(entry.id);
      entry.settle(false);
      if (stuck && live && proc) { try { proc.kill('SIGKILL'); } catch { /* best effort */ } }
    }, timeoutMs);
    queued.push(entry);
    pump();
  });
}

process.on('exit', () => {
  if (live && proc) { try { proc.kill('SIGKILL'); } catch { /* best effort */ } }
});

module.exports = { extract, stats };
