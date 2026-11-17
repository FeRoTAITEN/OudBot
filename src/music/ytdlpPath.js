const fs = require('fs');
const path = require('path');

const BIN_DIR = path.join(__dirname, '../../node_modules/youtube-dl-exec/bin');
const WIN_BIN = path.join(BIN_DIR, 'yt-dlp.exe');
const UNIX_BIN = path.join(BIN_DIR, 'yt-dlp');

let cachedBinary = null;

/** Resolve yt-dlp binary for Windows, Linux, or macOS. */
function resolveYtdlpBinary() {
  if (cachedBinary && fs.existsSync(cachedBinary)) return cachedBinary;

  const candidates = process.platform === 'win32'
    ? [WIN_BIN, UNIX_BIN]
    : [UNIX_BIN, WIN_BIN];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedBinary = candidate;
      return candidate;
    }
  }

  cachedBinary = process.platform === 'win32' ? WIN_BIN : UNIX_BIN;
  return cachedBinary;
}

module.exports = { resolveYtdlpBinary };
