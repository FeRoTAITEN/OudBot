const fs = require('fs');

// Server benchmark 2026-10-25 (8 videos, extract + download): tv_simply 8/8 in ~3.1 s,
// mweb 8/8 ~7.3 s, default 8/8 ~7.5 s, old tv,web,mweb 8/8 ~9.0 s; android_vr downloads 1/8.
// Re-test 2026-10-25 evening (yt-dlp 2026.10.21): tv_simply/mweb/tv now fail ("Requested format is not
// available" / "page needs to be reloaded"); default works in ~3.2 s -> default first.
const DEFAULT_PLAYER_CLIENT = process.env.YTDLP_PLAYER_CLIENT?.trim() || 'default';
const FALLBACK_CLIENTS = (process.env.YTDLP_FALLBACK_CLIENTS || 'tv_simply,mweb,tv')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function ytdlpCommonOptions({ playerClient } = {}) {
  const opts = {
    jsRuntimes: 'node',
    extractorArgs: `youtube:player_client=${playerClient || DEFAULT_PLAYER_CLIENT}`,
  };

  const cookies = process.env.YTDLP_COOKIES?.trim();
  if (cookies && fs.existsSync(cookies)) {
    opts.cookies = cookies;
    return opts;
  }

  const browser = process.env.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (browser) opts.cookiesFromBrowser = browser;

  return opts;
}

/** Options for youtube-dl-exec (camelCase). */
function ytdlpExecOptions(trackOpts = {}) {
  return ytdlpCommonOptions(trackOpts);
}

/** CLI args for execFile (youtubeSearch). */
function ytdlpCliPrefix(trackOpts = {}) {
  const opts = ytdlpCommonOptions(trackOpts);
  const args = ['--js-runtimes', 'node'];
  if (opts.extractorArgs) args.push('--extractor-args', opts.extractorArgs);
  if (opts.cookies) args.push('--cookies', opts.cookies);
  if (opts.cookiesFromBrowser) args.push('--cookies-from-browser', opts.cookiesFromBrowser);
  return args;
}

function nextFallbackClient(retryIndex) {
  if (!FALLBACK_CLIENTS.length) return 'tv';
  return FALLBACK_CLIENTS[Math.min(Math.max(retryIndex, 1) - 1, FALLBACK_CLIENTS.length - 1)];
}

function isYtdlp403Error(text) {
  return /403|forbidden/i.test(String(text || ''));
}

console.log(`[MUSIC] yt-dlp player_client=${DEFAULT_PLAYER_CLIENT} fallbacks=${FALLBACK_CLIENTS.join(',')}`);

module.exports = {
  ytdlpCommonOptions,
  ytdlpExecOptions,
  ytdlpCliPrefix,
  nextFallbackClient,
  isYtdlp403Error,
  DEFAULT_PLAYER_CLIENT,
};
