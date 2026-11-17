// oauth.js – Discord OAuth2 identity login.
// Identity-only integration: we never store the access token, never call any
// privileged Discord API, and never let the client_secret or the auth code
// leak into responses. Guild lookups happen later via the bot's own client.
'use strict';
const crypto = require('crypto');

const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';
const ME_URL = 'https://discord.com/api/v10/users/@me';

function cfg() {
  return {
    clientId: String(process.env.DISCORD_CLIENT_ID || '').trim(),
    clientSecret: String(process.env.DISCORD_CLIENT_SECRET || ''),
    publicUrl: String(process.env.WEB_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  };
}

/** OAuth login is only on when all three env vars are present. */
function enabled() {
  const c = cfg();
  return Boolean(c.clientId && c.clientSecret && c.publicUrl);
}

function redirectUri() {
  return `${cfg().publicUrl}/auth/callback`;
}

// States we issued (single use, 10 min). Lets the callback succeed when the browser lost the state cookie
// (phones: Discord app / another browser opens the callback). Cookie match is still accepted after a restart.
const STATE_TTL_MS = 10 * 60_000;
const STATE_MAX = 5000;
const issued = new Map();

function pruneStates(now = Date.now()) {
  for (const [s, exp] of issued) if (exp <= now) issued.delete(s);
  while (issued.size >= STATE_MAX) issued.delete(issued.keys().next().value);
}

/** 32 random bytes, hex-encoded; remembered server-side for one use. */
function newState() {
  const s = crypto.randomBytes(32).toString('hex');
  pruneStates();
  issued.set(s, Date.now() + STATE_TTL_MS);
  return s;
}

/** true once for a state we issued and that has not expired; removes it either way. */
function consumeState(s, now = Date.now()) {
  const exp = issued.get(String(s || ''));
  if (exp === undefined) return false;
  issued.delete(String(s));
  return exp > now;
}

/** Constant-time compare; false on missing or length-mismatched values. */
function checkState(cookieValue, queryValue) {
  const a = Buffer.from(String(cookieValue || ''));
  const b = Buffer.from(String(queryValue || ''));
  if (!a.length || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function authorizeUrl(state) {
  const c = cfg();
  const q = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    scope: 'identify guilds',
    redirect_uri: redirectUri(),
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

class OauthError extends Error {}

/**
 * Exchange the authorization code for a short-lived access token, resolve the
 * user from /users/@me, and return the minimal identity. The access token is
 * used only in this function and never stored. Errors carry short, fixed
 * messages that never contain the code or the secret.
 */
async function exchangeCode(code) {
  const c = cfg();
  try {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      redirect_uri: redirectUri(),
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
    const tr = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tr.ok) throw new OauthError('the login code was rejected');
    const access = (await tr.json()).access_token;
    if (!access) throw new OauthError('the login code was rejected');
    const ur = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!ur.ok) throw new OauthError('could not read your Discord profile');
    const me = await ur.json();
    if (!me?.id) throw new OauthError('could not read your Discord profile');
    return { id: String(me.id), username: me.username, globalName: me.globalName, avatar: me.avatar };
  } catch (err) {
    if (err instanceof OauthError) throw err;
    if (err?.name === 'AbortError') throw new OauthError('Discord timed out');
    throw new OauthError('Discord is unreachable');
  }
}

/** Validate a Discord avatar hash (32 hex, optional 'a_' prefix); null otherwise. */
function avatarHash(value) {
  const v = String(value ?? '');
  return /^(a_)?[0-9a-f]{32}$/.test(v) ? v : null;
}

/** Display name capped at 64 chars: globalName || username || id. */
function displayName(user, id) {
  return String(user?.globalName || user?.username || id || '').slice(0, 64);
}

module.exports = { enabled, authorizeUrl, exchangeCode, newState, checkState, consumeState, avatarHash, displayName };
