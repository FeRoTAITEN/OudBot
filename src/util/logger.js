function formatParts(tag, parts) {
  const prefix = tag ? `[${tag}]` : '';
  return [prefix, ...parts].filter(Boolean).join(' ');
}

function createLogger(tag) {
  return {
    info(...args) {
      console.log(formatParts(tag, args));
    },
    warn(...args) {
      console.warn(formatParts(tag, args));
    },
    error(...args) {
      console.error(formatParts(tag, args));
    },
    debug(...args) {
      if (process.env.DEBUG) console.log(formatParts(tag, args));
    },
  };
}

/** Log Discord API failures without throwing. */
function logDiscordFailure(tag, err, context = '') {
  const msg = err?.message || String(err);
  if (/unknown interaction|already been acknowledged|10062|40060/i.test(msg)) return;
  const log = createLogger(tag);
  log.warn(context ? `${context}: ${msg}` : msg);
}

const logOnceExpires = new Map();
const LOG_ONCE_MAX = 5000;
const LOG_ONCE_EVICT = 1000;

/** Run `fn` at most once per key until `ttlMs` has passed. Returns true if it ran. */
function logOnce(key, ttlMs, fn) {
  if (logOnceExpires.size > LOG_ONCE_MAX) {
    let evicted = 0;
    for (const k of logOnceExpires.keys()) {
      logOnceExpires.delete(k);
      if (++evicted >= LOG_ONCE_EVICT) break;
    }
  }
  const now = Date.now();
  if (logOnceExpires.has(key) && now < logOnceExpires.get(key)) return false;
  logOnceExpires.set(key, now + ttlMs);
  fn();
  return true;
}

module.exports = { createLogger, logDiscordFailure, logOnce };
