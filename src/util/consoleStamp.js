// consoleStamp.js — prefixes console.log/info/warn/error/debug with an ISO timestamp and redacts Discord bot tokens.
const TOKEN_RE = /[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,40}/g;
function redact(v) {
  if (v instanceof Error) return redact(v.stack || v.message);
  return typeof v === 'string' ? v.replace(TOKEN_RE, '<redacted-token>') : v;
}
function install() {
  if (console.__oudStamped) return;
  if (/^(0|false|no|off)$/i.test(process.env.LOG_TIMESTAMPS || '')) return;
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[m].bind(console);
    console[m] = (...args) => orig(new Date().toISOString(), ...args.map(redact));
  }
  console.__oudStamped = true;
}
module.exports = { install, redact, TOKEN_RE };
