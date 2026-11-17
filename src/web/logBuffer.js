// logBuffer.js – in-memory ring buffer of console output for the web dashboard (live tail + search)
const util = require('util');

const MAX = Math.max(200, parseInt(process.env.WEB_LOG_BUFFER || '3000', 10) || 3000);
const entries = [];
const listeners = new Set();
let seq = 0;
let installed = false;

function levelOf(method, text) {
  if (method === 'error') return 'error';
  if (method === 'warn') return 'warn';
  if (/\b(error|failed|fail|uncaught|rejection)\b/i.test(text)) return 'warn';
  return 'info';
}

function tagOf(text) {
  const m = /^\[([A-Z0-9:_-]{2,40})\]/.exec(text);
  return m ? m[1].split(':')[0] : '';
}

function push(method, args) {
  let text;
  try {
    text = util.format(...args);
  } catch {
    text = args.map(String).join(' ');
  }
  try {
    const { redact } = require('../util/consoleStamp');
    text = redact(text);
  } catch { /* consoleStamp optional */ }
  const entry = {
    id: ++seq,
    ts: Date.now(),
    level: levelOf(method, text),
    tag: tagOf(text),
    text: text.length > 4000 ? `${text.slice(0, 4000)}…` : text,
  };
  entries.push(entry);
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  for (const fn of listeners) {
    try { fn(entry); } catch { /* ignore */ }
  }
}

/** Wrap console.* (call after consoleStamp.install so the stamp stays on stdout). */
function install() {
  if (installed) return;
  installed = true;
  for (const method of ['log', 'info', 'warn', 'error']) {
    const orig = console[method].bind(console);
    console[method] = (...args) => {
      push(method, args);
      orig(...args);
    };
  }
}

function query({ level = null, q = '', sinceId = 0, limit = 500 } = {}) {
  const needle = String(q || '').toLowerCase();
  const levels = level === 'error' ? ['error'] : level === 'warn' ? ['warn', 'error'] : null;
  const out = [];
  for (let i = entries.length - 1; i >= 0 && out.length < limit; i--) {
    const e = entries[i];
    if (e.id <= sinceId) break;
    if (levels && !levels.includes(e.level)) continue;
    if (needle && !e.text.toLowerCase().includes(needle)) continue;
    out.push(e);
  }
  return out.reverse();
}

function counts(windowMs = 3600_000) {
  const cutoff = Date.now() - windowMs;
  let warn = 0;
  let error = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.ts < cutoff) break;
    if (e.level === 'error') error++;
    else if (e.level === 'warn') warn++;
  }
  return { warn, error };
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { install, query, counts, subscribe, push };
