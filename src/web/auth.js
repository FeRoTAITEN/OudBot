// auth.js – dashboard authentication: Discord DM magic links + challenge/response password, signed sessions
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const AUTH_FILE = path.join(DATA_DIR, 'web-auth.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'web-sessions.json');
const INITIAL_PW_FILE = path.join(DATA_DIR, 'web-initial-password.txt');

const PBKDF2_ITER = 60_000;
const SESSION_IDLE_MS = 12 * 3600_000;
const SESSION_MAX_MS = 7 * 24 * 3600_000;
const LINK_TTL_MS = 10 * 60_000;
const NONCE_TTL_MS = 2 * 60_000;

const sessions = new Map(); // sha256(token) -> session
const links = new Map(); // sha256(token) -> { identity, expires }
const nonces = new Map(); // nonceId -> { nonce, expires }
const NONCE_MAX = 1000;
const attempts = new Map(); // ip -> [ts]
let auth = null;
let persistTimer = null;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function pbkdf2(password, saltHex, iter = PBKDF2_ITER) {
  return crypto.pbkdf2Sync(Buffer.from(String(password), 'utf8'), Buffer.from(saltHex, 'hex'), iter, 32, 'sha256');
}

function loadAuth() {
  if (auth) return auth;
  const res = readJson(AUTH_FILE);
  if (res.ok && res.data?.verifier && res.data?.salt) {
    auth = res.data;
    return auth;
  }
  // First start: generate a strong password, store only its verifier, hand the password over via a file.
  const password = randomToken(15);
  setPassword(password, { initial: true });
  try {
    fs.writeFileSync(INITIAL_PW_FILE, `${password}\n`, { mode: 0o600 });
    console.log('[WEB] Initial dashboard password written to data/web-initial-password.txt (delete it after you change the password)');
  } catch (err) {
    console.warn(`[WEB] Could not write initial password file: ${err.message}`);
  }
  return auth;
}

function setPassword(password, { initial = false } = {}) {
  const salt = crypto.randomBytes(16).toString('hex');
  const verifier = pbkdf2(password, salt).toString('hex');
  auth = { salt, iterations: PBKDF2_ITER, verifier, updatedAt: new Date().toISOString(), initial };
  writeJsonAtomic(AUTH_FILE, auth);
  if (!initial) {
    try { fs.unlinkSync(INITIAL_PW_FILE); } catch { /* already gone */ }
  }
  return true;
}

function passwordStrongEnough(pw) {
  const s = String(pw || '');
  return s.length >= 10 && /[A-Za-z]/.test(s) && /\d/.test(s);
}

function rateLimited(ip, max = 10, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(ts => now - ts < windowMs);
  list.push(now);
  attempts.delete(ip); // re-insert = most recent last (Map order)
  attempts.set(ip, list);
  if (attempts.size > 5000) {
    // Never clear everything (that resets every limit): drop expired keys, then low-activity ones.
    // Keys at/over a limit are kept, so spraying many keys cannot unblock a limited one.
    for (const [k, l] of attempts) {
      if (!l.length || now - l[l.length - 1] >= windowMs) attempts.delete(k);
    }
    for (const [k, l] of attempts) {
      if (attempts.size <= 4000) break;
      if (l.length <= 2 && k !== ip) attempts.delete(k);
    }
  }
  return list.length > max;
}

function prune() {
  const now = Date.now();
  for (const [k, n] of nonces) if (n.expires < now) nonces.delete(k);
  for (const [k, l] of links) if (l.expires < now) links.delete(k);
  let dirty = false;
  for (const [k, s] of sessions) {
    if (now - s.lastSeen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS) {
      sessions.delete(k);
      dirty = true;
    }
  }
  if (dirty) schedulePersist();
}

function challenge() {
  prune();
  const a = loadAuth();
  const nonceId = randomToken(12);
  const nonce = crypto.randomBytes(16).toString('hex');
  nonces.set(nonceId, { nonce, expires: Date.now() + NONCE_TTL_MS });
  while (nonces.size > NONCE_MAX) nonces.delete(nonces.keys().next().value);
  return { salt: a.salt, iterations: a.iterations, nonceId, nonce };
}

/** proof = HMAC-SHA256(key = PBKDF2(password, salt), nonce). The password never crosses the wire. */
function verifyPasswordProof(nonceId, proofHex) {
  const n = nonces.get(String(nonceId));
  nonces.delete(String(nonceId));
  if (!n || n.expires < Date.now()) return false;
  const a = loadAuth();
  const expected = crypto.createHmac('sha256', Buffer.from(a.verifier, 'hex')).update(n.nonce).digest();
  let got;
  try { got = Buffer.from(String(proofHex), 'hex'); } catch { return false; }
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

function verifyPasswordPlain(password) {
  const a = loadAuth();
  const got = pbkdf2(password, a.salt, a.iterations);
  const exp = Buffer.from(a.verifier, 'hex');
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}

/**
 * identity: { userId, name, avatar, role: 'owner'|'guild', guilds: string[] }
 * Returns a one-time token for /auth/<token>.
 */
function createMagicLink(identity) {
  prune();
  const token = randomToken(32);
  links.set(sha256(token), { identity, expires: Date.now() + LINK_TTL_MS });
  return token;
}

function consumeMagicLink(token) {
  const key = sha256(String(token || ''));
  const l = links.get(key);
  links.delete(key);
  if (!l || l.expires < Date.now()) return null;
  return l.identity;
}

function createSession(identity, ip) {
  prune();
  const token = randomToken(32);
  const now = Date.now();
  const session = {
    id: randomToken(9),
    identity,
    csrf: randomToken(18),
    ip,
    created: now,
    lastSeen: now,
  };
  sessions.set(sha256(token), session);
  schedulePersist();
  return { token, session };
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(sha256(token));
  if (!s) return null;
  const now = Date.now();
  if (now - s.lastSeen > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS) {
    sessions.delete(sha256(token));
    schedulePersist();
    return null;
  }
  if (now - s.lastSeen > 60_000) schedulePersist();
  s.lastSeen = now;
  return s;
}

function destroySession(token) {
  if (sessions.delete(sha256(String(token || '')))) schedulePersist();
}

function destroyAllSessions(exceptId = null) {
  let n = 0;
  for (const [k, s] of sessions) {
    if (s.id === exceptId) continue;
    sessions.delete(k);
    n++;
  }
  schedulePersist();
  return n;
}

function destroySessionById(id) {
  for (const [k, s] of sessions) {
    if (s.id === id) { sessions.delete(k); schedulePersist(); return true; }
  }
  return false;
}

function destroyUserSessions(userId, exceptId = null) {
  let n = 0;
  for (const [k, s] of sessions) {
    if (s.identity?.userId && String(s.identity.userId) === String(userId) && s.id !== exceptId) { sessions.delete(k); n++; }
  }
  if (n) schedulePersist();
  return n;
}

function listSessions() {
  return [...sessions.values()].map(s => ({
    id: s.id,
    name: s.identity?.name,
    userId: s.identity?.userId,
    role: s.identity?.role,
    ip: s.ip,
    created: s.created,
    lastSeen: s.lastSeen,
  }));
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      writeJsonAtomic(SESSIONS_FILE, Object.fromEntries(sessions), { backup: false });
    } catch (err) {
      console.warn(`[WEB] Could not persist sessions: ${err.message}`);
    }
  }, 1500);
  persistTimer.unref?.();
}

function loadSessions() {
  const res = readJson(SESSIONS_FILE);
  if (!res.ok || !res.data || typeof res.data !== 'object') return;
  for (const [k, s] of Object.entries(res.data)) {
    if (s && s.identity && s.csrf) sessions.set(k, s);
  }
  prune();
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = {
  loadAuth,
  loadSessions,
  setPassword,
  passwordStrongEnough,
  rateLimited,
  challenge,
  verifyPasswordProof,
  verifyPasswordPlain,
  createMagicLink,
  consumeMagicLink,
  createSession,
  getSession,
  destroySession,
  destroyAllSessions,
  destroySessionById,
  destroyUserSessions,
  listSessions,
  persistSessions: schedulePersist,
  parseCookies,
  INITIAL_PW_FILE,
};
