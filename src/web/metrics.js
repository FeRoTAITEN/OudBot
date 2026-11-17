// metrics.js – container/process health sampled for the dashboard (cgroup v2 aware)
const fs = require('fs');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

const SAMPLE_MS = 5000;
const HISTORY = 720; // 1 hour at 5 s
const history = [];
let timer = null;
let lastCpu = null;
let collectors = { streams: () => 0, voice: () => 0, pings: () => [] };

const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

function readNum(file) {
  try {
    const v = fs.readFileSync(file, 'utf8').trim();
    if (v === 'max') return null;
    const n = Number(v.split(/\s+/)[0]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readCpuMax() {
  try {
    const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota === 'max') return os.cpus().length;
    return Number(quota) / Number(period);
  } catch {
    return os.cpus().length;
  }
}

function readCpuUsec() {
  try {
    const m = /usage_usec (\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'));
    if (m) return Number(m[1]);
  } catch { /* not cgroup v2 */ }
  const u = process.cpuUsage();
  return u.user + u.system;
}

function countProcesses() {
  // ffmpeg / yt-dlp children visible inside the container
  let ffmpeg = 0;
  let ytdlp = 0;
  try {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let cmd = '';
      try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
      if (/ffmpeg/.test(cmd)) ffmpeg++;
      else if (/yt-dlp/.test(cmd)) ytdlp++;
    }
  } catch { /* not linux */ }
  return { ffmpeg, ytdlp };
}

const CPU_LIMIT = readCpuMax();

function sample() {
  const now = Date.now();
  const usec = readCpuUsec();
  let cpuPct = 0;
  if (lastCpu) {
    const dt = (now - lastCpu.at) * 1000;
    if (dt > 0) cpuPct = Math.max(0, ((usec - lastCpu.usec) / dt) * 100);
  }
  lastCpu = { at: now, usec };

  const memCur = readNum('/sys/fs/cgroup/memory.current');
  const memMax = readNum('/sys/fs/cgroup/memory.max');
  const pidsCur = readNum('/sys/fs/cgroup/pids.current');
  const pidsMax = readNum('/sys/fs/cgroup/pids.max');
  const rss = process.memoryUsage().rss;
  const procs = countProcesses();

  let streams = 0;
  let voice = 0;
  try { streams = collectors.streams(); } catch { /* ignore */ }
  try { voice = collectors.voice(); } catch { /* ignore */ }

  const point = {
    ts: now,
    cpu: Math.round(cpuPct * 10) / 10, // % of ONE core
    cpuLimit: CPU_LIMIT,
    mem: memCur ?? rss,
    memMax: memMax ?? os.totalmem(),
    rss,
    pids: pidsCur,
    pidsMax,
    loopMs: Number.isFinite(loopDelay.mean) ? Math.round((loopDelay.mean / 1e6) * 10) / 10 : 0,
    loopMaxMs: Number.isFinite(loopDelay.max) ? Math.round(loopDelay.max / 1e6) : 0,
    streams,
    voice,
    ffmpeg: procs.ffmpeg,
    ytdlp: procs.ytdlp,
  };
  loopDelay.reset();
  history.push(point);
  if (history.length > HISTORY) history.splice(0, history.length - HISTORY);
  return point;
}

function start(opts = {}) {
  collectors = { ...collectors, ...opts };
  if (timer) return;
  sample();
  timer = setInterval(sample, SAMPLE_MS);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function latest() {
  return history[history.length - 1] || sample();
}

function getHistory(points = HISTORY) {
  return history.slice(-points);
}

module.exports = { start, stop, latest, getHistory, sample, SAMPLE_MS };
