// guestLinks.js – T51: time-limited guest listen links. Only a hash of each secret is stored.
const crypto = require('crypto');
const path = require('path');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'guest-links.json');
const HOURS = [1, 6, 24, 168];
const MAX_PER_GUILD = 20;
let cache = null;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function load() {
  if (cache) return cache;
  const r = readJson(FILE);
  cache = r.ok && r.data && typeof r.data === 'object' ? r.data : {};
  return cache;
}

function save() {
  writeJsonAtomic(FILE, cache, { backup: false });
}

function prune() {
  const all = load();
  const now = Date.now();
  let changed = false;
  for (const [id, e] of Object.entries(all)) {
    if (!e || Date.parse(e.exp) <= now) { delete all[id]; changed = true; }
  }
  if (changed) save();
  return all;
}

const view = (id, e) => ({ id, label: e.label, exp: e.exp, created: e.created, byName: e.byName, listeners: sockets.get(id)?.size || 0 });

/** New link for a guild. Returns { token, link } — the token is shown once and never stored. */
function create(guildId, { hours, label, by, byName }) {
  const all = prune();
  const gid = String(guildId);
  if (Object.values(all).filter(e => e.gid === gid).length >= MAX_PER_GUILD) return { error: 'too many links' };
  const h = HOURS.includes(Number(hours)) ? Number(hours) : 24;
  const id = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  const e = {
    gid,
    hash: sha(secret),
    label: String(label || '').trim().slice(0, 40) || null,
    by: String(by || ''),
    byName: String(byName || '').slice(0, 64),
    created: new Date().toISOString(),
    exp: new Date(Date.now() + h * 3600_000).toISOString(),
  };
  all[id] = e;
  save();
  return { token: `${id}.${secret}`, link: view(id, e) };
}

function list(guildId) {
  const gid = String(guildId);
  return Object.entries(prune()).filter(([, e]) => e.gid === gid).map(([id, e]) => view(id, e))
    .sort((a, b) => a.exp.localeCompare(b.exp));
}

function revoke(guildId, id) {
  const all = load();
  const e = all[String(id)];
  if (!e || e.gid !== String(guildId)) return false;
  delete all[String(id)];
  save();
  return true;
}

/** token -> { id, gid, label, exp } or null (unknown, wrong secret or expired). */
function verify(token) {
  const m = /^([0-9a-f]{8})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!m) return null;
  const e = load()[m[1]];
  if (!e || Date.parse(e.exp) <= Date.now()) return null;
  const a = Buffer.from(sha(m[2]), 'hex');
  const b = Buffer.from(String(e.hash), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: m[1], gid: e.gid, label: e.label, exp: e.exp };
}

// Open guest sockets per link, so a revoke cuts them at once.
const sockets = new Map();
function track(id, ws) {
  if (!sockets.has(id)) sockets.set(id, new Set());
  sockets.get(id).add(ws);
  ws.on('close', () => { sockets.get(id)?.delete(ws); if (!sockets.get(id)?.size) sockets.delete(id); });
}
function closeAll(id) {
  for (const ws of sockets.get(String(id)) || []) { try { ws.sendText(JSON.stringify({ error: 'revoked' })); ws.close(1008); } catch { /* closed */ } }
}
const listeners = (id) => sockets.get(String(id))?.size || 0;

/** Test hook: point the store at another file. */
function _setFile(fp) { FILE = fp; cache = null; }

module.exports = { create, list, revoke, verify, track, closeAll, listeners, HOURS, _setFile };
