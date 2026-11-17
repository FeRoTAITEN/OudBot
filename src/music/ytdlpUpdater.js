const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../util/logger');
const { resolveYtdlpBinary } = require('./ytdlpPath');

const log = createLogger('YTDLP');
const STAMP_FILE = path.join(__dirname, '../../data/ytdlp-last-update.txt');
const DAY_MS = 24 * 60 * 60 * 1000;

function isEnabled() {
  const raw = process.env.YTDLP_AUTO_UPDATE?.trim();
  if (raw === '0' || /^false|off|no$/i.test(raw || '')) return false;
  return true;
}

function shouldRunToday() {
  try {
    const last = parseInt(fs.readFileSync(STAMP_FILE, 'utf8').trim(), 10);
    if (Number.isFinite(last) && Date.now() - last < DAY_MS) return false;
  } catch { /* no stamp yet */ }
  return true;
}

function writeStamp() {
  try {
    fs.mkdirSync(path.dirname(STAMP_FILE), { recursive: true });
    fs.writeFileSync(STAMP_FILE, String(Date.now()));
  } catch { /* ignore */ }
}

/** Background yt-dlp self-update — at most once per day when enabled. */
function scheduleYtdlpUpdate(tag = '[LAUNCHER]') {
  if (!isEnabled() || !shouldRunToday()) return;
  const binary = resolveYtdlpBinary();
  if (!fs.existsSync(binary)) {
    log.warn(`${tag} yt-dlp binary not found — skip update`);
    return;
  }

  const proc = spawn(binary, ['-U', '--no-warnings'], { windowsHide: true });
  let out = '';
  proc.stdout?.on('data', (chunk) => { out += chunk; });
  proc.stderr?.on('data', (chunk) => { out += chunk; });
  proc.on('close', (code) => {
    writeStamp();
    const summary = out.trim().split('\n').filter(Boolean).slice(-2).join(' ').trim();
    if (code === 0) {
      log.info(`${tag} yt-dlp update ok${summary ? `: ${summary}` : ''}`);
    } else {
      log.warn(`${tag} yt-dlp update exit ${code}${summary ? `: ${summary}` : ''}`);
    }
  });
  proc.on('error', (err) => {
    log.warn(`${tag} yt-dlp update failed: ${err.message}`);
  });
}

module.exports = { scheduleYtdlpUpdate };
