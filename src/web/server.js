// server.js – Oud web dashboard: static UI + JSON API + live events on the server's own port (Pterodactyl SERVER_PORT)
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const auth = require('./auth');
const api = require('./api');
const metrics = require('./metrics');
const logBuffer = require('./logBuffer');
const identity = require('./identity');
const memberAccess = require('./memberAccess');
const audit = require('./audit');
const alerts = require('./alerts');
const tls = require('./tls');
const oauth = require('./oauth');
const wsLite = require('./wsLite');
const webMix = require('./webMix');
const subscriptionStore = require('../subscription/subscriptionStore');

const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'oud_sid';
const MAX_BODY = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const DASHBOARD_WORDS = new Set(['dashboard', 'web', 'ويب', 'داشبورد', 'الداشبورد', 'لوحة الويب']);

let server = null;
/** true when the dashboard listens with TLS (same port, plain HTTP is redirected). */
let tlsActive = false;
const sseClients = new Set();
const staticCache = new Map();

function enabled() {
  return process.env.WEB_DASHBOARD !== '0';
}

function port() {
  return parseInt(process.env.WEB_PORT || process.env.SERVER_PORT || '0', 10) || 0;
}

function publicUrl() {
  const u = process.env.WEB_PUBLIC_URL?.trim();
  if (u) return u.replace(/\/+$/, '');
  const ip = process.env.SERVER_IP?.trim();
  return `${tlsActive ? 'https' : 'http'}://${ip && ip !== '0.0.0.0' ? ip : 'localhost'}:${port()}`;
}

// Behind cloudflared the socket address is the Docker gateway (172.18.0.1) for everyone, so a
// private/loopback hop uses Cloudflare's CF-Connecting-IP. Port 7509 is also reachable directly
// through docker-proxy (same gateway address), so that header can be forged there: use the result
// for display and per-IP limits only; anything brute-forceable also has a global cap.
const PRIVATE_HOP = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;
function clientIp(req) {
  const sock = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!PRIVATE_HOP.test(sock)) return sock;
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  return net.isIP(cf) ? cf : sock;
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: https://cdn.discordapp.com https://i.ytimg.com https://*.ytimg.com https://*.sndcdn.com https://*.bcbits.com https://*.mixcloud.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    `connect-src 'self' wss://${(() => { try { return new URL(publicUrl()).host; } catch { return 'localhost'; } })()}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; '));
}

function send(res, status, body, headers = {}) {
  securityHeaders(res);
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

/** Bilingual "login did not complete" page with a button that restarts Discord login directly. */
function loginRetryPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oud</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0c0a;color:#efe6da;font-family:system-ui,sans-serif;text-align:center;padding:16px;box-sizing:border-box">
<div style="max-width:380px">
<p style="font-size:18px;margin:0 0 6px">ما اكتمل تسجيل الدخول</p>
<p style="margin:0 0 4px;color:#a89a8a" dir="ltr">Login did not complete.</p>
<p style="margin:0 0 20px;color:#a89a8a;font-size:14px">افتح الرابط بنفس المتصفح وكمّل في صفحة Discord.<br><span dir="ltr">Open it in the same browser and approve on Discord.</span></p>
<a href="/auth/discord/login" style="display:inline-block;background:#e3a857;color:#1a1208;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px">حاول مرة ثانية · Try again</a>
<p style="margin-top:16px"><a href="/" style="color:#a89a8a;font-size:14px">الرئيسية · Home</a></p>
</div></body></html>`;
}

function sendJson(req, res, status, data) {
  const json = JSON.stringify(data ?? null);
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (json.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    return send(res, status, zlib.gzipSync(json), headers);
  }
  return send(res, status, json, headers);
}

function setSessionCookie(res, token) {
  const secure = res.req?.socket?.encrypted || publicUrl().startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new api.HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new api.HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

let cachedVersion = null;
function assetVersion() {
  if (cachedVersion && process.env.WEB_DEV !== '1') return cachedVersion;
  const h = require('crypto').createHash('sha1');
  for (const f of fs.readdirSync(PUBLIC_DIR).sort()) {
    if (f === 'index.html') continue;
    try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch { /* ignore */ }
  }
  cachedVersion = h.digest('hex').slice(0, 10);
  return cachedVersion;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = path.normalize(rel).replace(/^([/\\])+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden');
  let entry = staticCache.get(file);
  if (!entry) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return send(res, 404, 'not found', { 'Content-Type': 'text/plain' }); }
    if (rel === 'index.html' || rel === 'guest.html') {
      // Cache-bust assets: /app.js -> /app.js?v=<content hash> so browsers never run stale UI after a deploy.
      const v = assetVersion();
      buf = Buffer.from(buf.toString('utf8').replace(/(src|href)="\/([\w.-]+\.(?:js|css|svg|webmanifest))"/g, `$1="/$2?v=${v}"`));
    }
    entry = { buf, gz: zlib.gzipSync(buf), type: MIME[path.extname(file)] || 'application/octet-stream' };
    if (process.env.WEB_DEV !== '1') staticCache.set(file, entry);
  }
  const headers = {
    'Content-Type': entry.type,
    'Cache-Control': (rel === 'index.html' || rel === 'guest.html') ? 'no-cache' : (/[?&]v=/.test(req.url) ? 'public, max-age=31536000, immutable' : 'public, max-age=300'),
  };
  securityHeaders(res);
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    return res.end(entry.gz);
  }
  res.writeHead(200, headers);
  return res.end(entry.buf);
}

function sessionFrom(req) {
  const token = auth.parseCookies(req.headers.cookie)[COOKIE];
  const session = auth.getSession(token);
  return { token, session };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ---------- auth endpoints ----------

async function handleAuth(req, res, pathname, ip) {
  // Emergency switch: password + DM-link login are disabled (404) by default; set
  // WEB_PASSWORD_LOGIN=1 to re-enable them.
  const pwOn = process.env.WEB_PASSWORD_LOGIN === '1';
  if (pathname === '/api/auth/challenge' && req.method === 'GET') {
    if (!pwOn) return sendJson(req, res, 404, { error: 'not found' });
    if (auth.rateLimited(`challenge:${clientIp(req)}`, 30, 60_000)) return sendJson(req, res, 429, { error: 'too many requests' });
    return sendJson(req, res, 200, auth.challenge());
  }
  if (pathname === '/api/auth/password' && req.method === 'POST') {
    if (!pwOn) return sendJson(req, res, 404, { error: 'not found' });
    if (auth.rateLimited(`pw:${ip}`, 8) || auth.rateLimited('pw:*', 100)) return sendJson(req, res, 429, { error: 'too many attempts, wait 10 minutes' });
    const body = await readBody(req);
    if (!auth.verifyPasswordProof(body.nonceId, body.proof)) {
      console.warn(`[WEB] Failed password login from ${ip}`);
      return sendJson(req, res, 401, { error: 'wrong password' });
    }
    const who = { userId: null, name: 'Owner (password)', avatar: null, role: 'owner', guilds: [] };
    const { token, session } = auth.createSession(who, ip);
    setSessionCookie(res, token);
    audit.record({ identity: who, ip }, 'auth.login.password');
    console.log(`[WEB] Owner logged in with password from ${ip}`);
    return sendJson(req, res, 200, { ok: true, csrf: session.csrf });
  }
  if (pathname === '/api/auth/discord' && req.method === 'POST') {
    if (!pwOn) return sendJson(req, res, 404, { error: 'not found' });
    if (auth.rateLimited(`dm:${ip}`, 5)) return sendJson(req, res, 429, { error: 'too many requests, wait 10 minutes' });
    const body = await readBody(req);
    const userId = String(body.userId || '').trim();
    const generic = { ok: true, message: 'If this account may use the dashboard, a login link was sent by DM.' };
    if (!/^\d{17,20}$/.test(userId)) return sendJson(req, res, 400, { error: 'enter your Discord user ID (17-20 digits)' });
    if (auth.rateLimited(`dmu:${userId}`, 3)) return sendJson(req, res, 200, generic);
    const client = api.masterClient();
    const who = await identity.fromUserId(client, userId).catch(() => null);
    if (who) await sendLoginDm(client, who).catch(() => {});
    return sendJson(req, res, 200, generic);
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const { token, session } = sessionFrom(req);
    if (session) audit.record({ identity: session.identity, ip }, 'auth.logout');
    auth.destroySession(token);
    clearSessionCookie(res);
    return sendJson(req, res, 200, { ok: true });
  }
  if (pathname === '/api/auth/methods' && req.method === 'GET') {
    return sendJson(req, res, 200, { discord: oauth.enabled(), password: pwOn });
  }
  if (pathname === '/auth/discord/login' && req.method === 'GET') {
    if (!oauth.enabled()) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    if (auth.rateLimited(`oauth:${ip}`, 20, 60_000)) return sendJson(req, res, 429, { error: 'too many requests, wait a minute' });
    const state = oauth.newState();
    const secure = res.req?.socket?.encrypted || publicUrl().startsWith('https://') ? ' Secure' : '';
    res.setHeader('Set-Cookie', `oud_oauth_state=${state}; HttpOnly${secure}; SameSite=Lax; Path=/auth; Max-Age=600`);
    return send(res, 302, '', { Location: oauth.authorizeUrl(state) });
  }
  if (pathname === '/auth/callback' && req.method === 'GET') {
    if (!oauth.enabled()) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
    if (auth.rateLimited(`oauthcb:${ip}`, 20, 60_000)) return sendJson(req, res, 429, { error: 'too many requests, wait a minute' });
    const qs = new URL(req.url, 'http://x').searchParams;
    const state = auth.parseCookies(req.headers.cookie).oud_oauth_state;
    const queryState = qs.get('state');
    const code = qs.get('code');
    const clearState = () => res.setHeader('Set-Cookie', 'oud_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0');
    // Cookie match, or (cookie lost on phones) a state this server issued and has not used yet.
    const cookieOk = !!state && oauth.checkState(state, queryState);
    const issuedOk = !!queryState && oauth.consumeState(queryState);
    const reason = qs.get('error') ? `denied (${String(qs.get('error')).slice(0, 40)})`
      : !code || !queryState ? 'missing code/state'
        : cookieOk || issuedOk ? null
          : !state ? 'no state cookie and state unknown/expired/used' : 'state mismatch';
    if (reason) {
      clearState();
      console.warn(`[WEB] Discord login not completed from ${ip}: ${reason}`);
      return send(res, 400, loginRetryPage(), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (!cookieOk) console.log(`[WEB] Discord login from ${ip}: state cookie ${state ? 'mismatch' : 'missing'}, issued state accepted`);
    let me;
    try {
      me = await oauth.exchangeCode(code);
    } catch (err) {
      clearState();
      console.warn(`[WEB] Discord login failed from ${ip}: ${err.message}`);
      return send(res, 400, loginRetryPage(), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    clearState();
    const who = await resolveRole(api.masterClient(), me);
    // T23c: sessions store the hash-only avatar + capped name (URL built per-render by /api/me).
    who.name = oauth.displayName(me, me.id);
    who.avatar = oauth.avatarHash(me.avatar);
    const { token } = auth.createSession(who, ip);
    setSessionCookie(res, token);
    // clearState() above set Set-Cookie; setSessionCookie overwrote it — send both.
    res.setHeader('Set-Cookie', ['oud_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0', res.getHeader('Set-Cookie')]);
    audit.record({ identity: who, ip }, 'auth.login.discord-oauth');
    console.log(`[WEB] ${who.name} (${who.role}) logged in via Discord OAuth from ${ip}`);
    return send(res, 302, '', { Location: '/#/' });
  }
  if (pathname.startsWith('/auth/') && req.method === 'GET') {
    const who = auth.consumeMagicLink(pathname.slice(6));
    if (!who) {
      return send(res, 302, '', { Location: '/#/login?expired=1' });
    }
    // T23c: fill name/avatar (hash-only) from the bot's cached users when available, else null.
    const cached = api.masterClient()?.users?.cache?.get(String(who.userId ?? ''));
    if (cached) {
      who.name = oauth.displayName(cached, who.userId);
      who.avatar = oauth.avatarHash(cached.avatar);
    } else {
      who.avatar = null;
    }
    const { token } = auth.createSession(who, ip);
    setSessionCookie(res, token);
    audit.record({ identity: who, ip }, 'auth.login.discord');
    console.log(`[WEB] ${who.name} (${who.role}) logged in via Discord link from ${ip}`);
    return send(res, 302, '', { Location: '/#/' });
  }
  return false;
}

/**
 * Role for a Discord user right now: owner / subsadmin / guild (Manage Server on a subscribed server) / member.
 * Everyone but the owner also gets memberGuilds: subscribed servers they are in without full access.
 */
async function resolveRole(client, user) {
  const id = String(user.id);
  if (identity.ownerIds().has(id)) {
    return identity.ownerIdentity({ id, username: user.username, globalName: user.globalName, displayAvatarURL: () => null });
  }
  const who = await identity.fromUserId(client, id).catch(() => null)
    || { userId: id, name: user.globalName || user.username || id, avatar: null, role: 'member', guilds: [] };
  const full = new Set(who.guilds || []);
  // T81: a scoped manager sees his servers only (not the others he is a member of).
  who.memberGuilds = who.scopedManager ? [] : (await memberAccess.memberGuildsOf(client, id).catch(() => [])).filter(g => !full.has(g));
  return who;
}

// Roles are re-checked live (at most once a minute per session): removing an admin, a role or Manage Server
// takes effect without a re-login. Password sessions (no user id) stay owner.
const ROLE_RECHECK_MS = 60_000;
const rechecks = new Map();

function roleKey(i) {
  return [i?.role, [...(i?.guilds || [])].sort().join(','), [...(i?.memberGuilds || [])].sort().join(',')].join('|');
}

async function refreshIdentity(session, ip) {
  const cur = session.identity;
  if (!cur?.userId) return;
  if (Date.now() - (session.roleCheckedAt || 0) < ROLE_RECHECK_MS) return;
  const client = api.masterClient();
  if (!client?.isReady?.()) return;
  if (!rechecks.has(session.id)) {
    rechecks.set(session.id, (async () => {
      try {
        const next = await resolveRole(client, { id: cur.userId, username: cur.name });
        next.name = cur.name;
        next.avatar = cur.avatar;
        session.roleCheckedAt = Date.now();
        if (roleKey(next) !== roleKey(cur)) {
          console.log(`[WEB] ${cur.name} role changed: ${cur.role} -> ${next.role}`);
          audit.record({ identity: next, ip }, 'auth.role.changed', { from: cur.role, to: next.role });
        }
        session.identity = next;
        auth.persistSessions();
      } finally {
        rechecks.delete(session.id);
      }
    })());
  }
  await rechecks.get(session.id).catch(() => {});
}

async function sendLoginDm(client, who) {
  const user = await client.users.fetch(who.userId);
  const token = auth.createMagicLink(who);
  const url = `${publicUrl()}/auth/${token}`;
  const scope = who.role === 'owner' ? 'كامل الصلاحيات / full access' : who.role === 'manager' ? 'مدير / manager' : `سيرفرك فقط / your server only`;
  await user.send({
    content: [
      '🔐 **Oud Dashboard**',
      `${url}`,
      `• ${scope}`,
      '• الرابط صالح 10 دقائق ولمرة واحدة — لا تشاركه / valid 10 min, one use — do not share',
    ].join('\n'),
  });
}

// ---------- SSE ----------

function handleStream(req, res, session) {
  securityHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  // Owner is read per event (not at connect): a role removed by the live re-check stops the log feed at once.
  const client = { res, session, get owner() { return identity.isStaff(session.identity); } };
  sseClients.add(client);
  const off = logBuffer.subscribe((e) => {
    if (!client.owner) return;
    // T57: managers get the live log with IPs masked (the owner sees them).
    const out = session.identity?.role === 'owner' ? e : { ...e, text: api.maskIps(e.text) };
    try { res.write(`event: log\ndata: ${JSON.stringify(out)}\n\n`); } catch { /* closed */ }
  });
  req.on('close', () => {
    off();
    sseClients.delete(client);
  });
}

function broadcastTick() {
  if (!sseClients.size) return;
  const point = metrics.latest();
  const all = api.listQueues().filter(([, q]) => q.current).map(([k, q]) => api.queueView(k, q));
  for (const c of sseClients) {
    const queues = all.filter(q => memberAccess.canViewGuild(c.session.identity, q.guildId));
    const payload = { metrics: c.owner ? point : { streams: point.streams }, queues, ts: Date.now() };
    try { c.res.write(`event: tick\ndata: ${JSON.stringify(payload)}\n\n`); } catch { /* closed */ }
  }
}

// ---------- web listening over WebSocket (T41) ----------

/** T42b: refuse an accepted listen socket with a reason code the page can show, and log it. */
function denyListen(req, socket, head, code, guildId, userId) {
  console.log(`[WEBLISTEN] refused ${code} g=${guildId || '-'} user=${userId || '-'}`);
  const ws = wsLite.accept(req, socket, head);
  if (!ws) return undefined;
  ws.sendText(JSON.stringify({ error: code }));
  ws.close(1008);
  return undefined;
}

const GUEST_MAX_PER_LINK = 10;

/** Listener's own volumes ({ vol: { music|<userId>: 0..2 } }): true when the message was one. */
function applyVolMessage(ws, m) {
  if (!m || typeof m.vol !== 'object' || !m.vol) return false;
  const gains = {};
  let custom = false;
  for (const [k, v] of Object.entries(m.vol).slice(0, 120)) {
    if (!/^(music|\d{17,20})$/.test(k)) continue;
    const g = Math.max(0, Math.min(2, Number(v)));
    if (!Number.isFinite(g)) continue;
    gains[k] = g;
    if (g !== 1) custom = true;
  }
  webMix.setGains(ws, custom ? gains : null);
  return true;
}

/** T51: listener with a guest link (no login): /api/listen/ws?k=<token>&sel=... Room picker and (T66) names + own volumes, like the dashboard. */
async function onGuestUpgrade(req, socket, head, url, key) {
  const gl = require('./guestLinks');
  const link = gl.verify(key);
  if (!link) return denyListen(req, socket, head, 'expired');
  const guildId = link.gid;
  const who = `guest:${link.id}`;
  const sel = String(url.searchParams.get('sel') || 'all');
  if (!/^(all|main|room:[\w-]{1,32})$/.test(sel)) return wsLite.reject(socket, 400, 'Bad Request');
  const feats = subscriptionStore.getGuildFeatures(guildId);
  if (!feats?.allowed || !feats.webListen) return denyListen(req, socket, head, 'off', guildId, who);
  const guild = api.masterClient()?.guilds?.cache?.get(guildId);
  if (!guild) return denyListen(req, socket, head, 'noguild', guildId, who);
  const userId = `${who}:${require('crypto').randomBytes(3).toString('hex')}`;
  if (gl.listeners(link.id) >= GUEST_MAX_PER_LINK || webMix.check({ guildId, userId })) return denyListen(req, socket, head, 'busy', guildId, who);
  const ws = wsLite.accept(req, socket, head);
  if (!ws) return undefined;
  const rooms = webMix.selections(guildId);
  if (!rooms.some(r => r.sel === sel)) {
    ws.sendText(JSON.stringify({ error: 'room', rooms }));
    ws.close(1008);
    return undefined;
  }
  ws.sendText(JSON.stringify({ rooms, sel, guest: true, guild: guild.name, exp: link.exp, label: link.label, members: sel === 'main' ? [] : webMix.members(guildId, sel) }));
  webMix.join(ws, { guildId, sel, userId });
  gl.track(link.id, ws);
  let lastVol = 0;
  ws.on('text', (txt) => {
    // Guests: own volume only (rate-limited); nothing else is accepted.
    if (Date.now() - lastVol < 200) return;
    let m;
    try { m = JSON.parse(txt); } catch { return; }
    if (applyVolMessage(ws, m)) lastVol = Date.now();
  });
  console.log(`[WEBLISTEN] guest joined g=${guildId} link=${link.id} sel=${sel}`);
  const since = Date.now();
  // The link runs out while listening -> cut.
  const endT = setTimeout(() => { try { ws.sendText(JSON.stringify({ error: 'expired' })); ws.close(1008); } catch { /* closed */ } }, Math.max(0, Math.min(Date.parse(link.exp) - Date.now(), 2147483000)));
  ws.on('close', () => {
    clearTimeout(endT);
    console.log(`[WEBLISTEN] guest closed g=${guildId} link=${link.id} after ${Math.round((Date.now() - since) / 1000)}s`);
  });
  return undefined;
}

/** GET /api/listen/ws?g=<guildId>&sel=all|main|room:<name> (WebSocket). Members of the server; switch webListen. */
async function onUpgrade(req, socket, head) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return wsLite.reject(socket, 400, 'Bad Request'); }
  if (url.pathname !== '/api/listen/ws') return wsLite.reject(socket, 404, 'Not Found');
  if (!sameOrigin(req)) return wsLite.reject(socket, 403, 'Forbidden');
  const guestKey = url.searchParams.get('k');
  if (guestKey) return onGuestUpgrade(req, socket, head, url, guestKey);
  const { session } = sessionFrom(req);
  if (!session) return denyListen(req, socket, head, 'login');
  try { await refreshIdentity(session, clientIp(req)); } catch { /* keep current identity */ }
  const who = session.identity || {};
  const guildId = String(url.searchParams.get('g') || '');
  const sel = String(url.searchParams.get('sel') || 'all');
  if (!/^\d{17,20}$/.test(guildId) || !/^(all|main|room:[\w-]{1,32})$/.test(sel)) return wsLite.reject(socket, 400, 'Bad Request');
  if (!memberAccess.canViewGuild(who, guildId)) return denyListen(req, socket, head, 'forbidden', guildId, who.userId);
  // T81: listening can be hidden from server admins.
  if (identity.canAccessGuild(who, guildId) && identity.sectionLevel(who, guildId, 'webListen') === 'hide') return denyListen(req, socket, head, 'off', guildId, who.userId);
  const feats = subscriptionStore.getGuildFeatures(guildId);
  if (!feats?.allowed || !feats.webListen) return denyListen(req, socket, head, 'off', guildId, who.userId);
  const guild = api.masterClient()?.guilds?.cache?.get(guildId);
  if (!guild) return denyListen(req, socket, head, 'noguild', guildId, who.userId);
  const member = await memberAccess.memberOf(guild, who.userId);
  if (member && memberAccess.levelForMember(member, guild, null) === 'banned') return denyListen(req, socket, head, 'forbidden', guildId, who.userId);
  const userId = String(who.userId || session.id);
  if (webMix.check({ guildId, userId })) return denyListen(req, socket, head, 'busy', guildId, userId);

  const ws = wsLite.accept(req, socket, head);
  if (!ws) return undefined;
  const rooms = webMix.selections(guildId);
  if (!rooms.some(r => r.sel === sel)) {
    ws.sendText(JSON.stringify({ error: 'room', rooms }));
    ws.close(1008);
    return undefined;
  }
  ws.sendText(JSON.stringify({ rooms, sel, bridge: Boolean(feats.bridge), members: sel === 'main' ? [] : webMix.members(guildId, sel) }));
  webMix.join(ws, { guildId, sel, userId });
  console.log(`[WEBLISTEN] joined g=${guildId} sel=${sel} user=${userId} rooms=${rooms.map(r => r.sel).join(',')}`);
  const since = Date.now();
  let lastStat = 0;
  ws.on('text', (txt) => {
    let m;
    try { m = JSON.parse(txt); } catch { return; }
    if (applyVolMessage(ws, m)) return;
    if (Date.now() - lastStat < 5000) return;
    lastStat = Date.now();
    const s = m?.stat;
    if (!s || typeof s !== 'object') return;
    const n = (v) => (Number.isFinite(+v) ? Math.round(+v) : 0);
    console.log(`[WEBLISTEN] client g=${guildId} sel=${sel} user=${userId} rx=${n(s.rx)} msgs=${n(s.msgs)} gap=${n(s.gap)} err=${n(s.err)} under=${n(s.under)} drop=${n(s.drop)} q=${n(s.q)}ms`);
    try { require('../bridge/bridgeDiag').noteWeb(String(guildId), n(s.under), n(s.drop)); } catch { /* diag off */ }
  });
  ws.on('close', () => console.log(`[WEBLISTEN] closed g=${guildId} sel=${sel} user=${userId} after ${Math.round((Date.now() - since) / 1000)}s`));
  return undefined;
}

// ---------- main handler ----------

async function handle(req, res) {
  const ip = clientIp(req);
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    return send(res, 400, 'bad request');
  }
  const { pathname } = url;

  try {
    if (pathname === '/healthz') {
      const c = api.masterClient();
      return sendJson(req, res, c?.isReady?.() ? 200 : 503, { ok: Boolean(c?.isReady?.()), uptime: Math.round(process.uptime()) });
    }

    if (pathname.startsWith('/api/auth/') || pathname.startsWith('/auth/')) {
      if (req.method === 'POST' && !sameOrigin(req)) return sendJson(req, res, 403, { error: 'cross-origin' });
      const handled = await handleAuth(req, res, pathname, ip);
      if (handled !== false) return handled;
    }

    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

    const { session } = sessionFrom(req);
    if (!session) return sendJson(req, res, 401, { error: 'login required' });
    if (session.ip !== ip) { session.ip = ip; auth.persistSessions(); }
    await refreshIdentity(session, ip);
    // T24: plain members only reach the player endpoints (per-room levels are checked in api.js).
    if (session.identity?.role === 'member' && !memberAccess.allowedPath(req.method, pathname)) {
      return sendJson(req, res, 403, { error: 'not allowed' });
    }
    if (auth.rateLimited(`api:${session.id}`, 600, 60_000)) return sendJson(req, res, 429, { error: 'slow down' });

    if (pathname === '/api/stream' && req.method === 'GET') return handleStream(req, res, session);

    if (req.method !== 'GET') {
      if (!sameOrigin(req)) return sendJson(req, res, 403, { error: 'cross-origin' });
      if (req.headers['x-oud-csrf'] !== session.csrf) return sendJson(req, res, 403, { error: 'csrf' });
    }

    const route = api.match(req.method, pathname);
    if (!route) return sendJson(req, res, 404, { error: 'not found' });
    const body = req.method === 'GET' ? {} : await readBody(req);
    const ctx = { identity: session.identity, session, ip };
    const data = await route.fn(ctx, route.params, body, url.searchParams);
    return sendJson(req, res, 200, data);
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error(`[WEB] ${req.method} ${pathname} failed: ${err?.stack || err?.message || err}`);
    if (!res.headersSent) return sendJson(req, res, status, { error: status >= 500 ? 'internal error' : err.message });
    try { res.end(); } catch { /* ignore */ }
  }
}

function start(tag = '[WEB]') {
  if (!enabled()) {
    console.log(`${tag} Dashboard disabled (WEB_DASHBOARD=0)`);
    return null;
  }
  const p = port();
  if (!p) {
    console.log(`${tag} Dashboard not started — no SERVER_PORT/WEB_PORT`);
    return null;
  }
  if (server) return server;
  auth.loadAuth();
  auth.loadSessions();
  metrics.start({ streams: api.activeStreams, voice: api.voiceConnections });
  alerts.start({ client: api.masterClient, ownerIds: identity.ownerIds, voiceDown: api.voiceDownGuilds });
  const onRequest = (req, res) => {
    handle(req, res).catch((err) => {
      console.error(`${tag} handler crash: ${err?.message || err}`);
      try { res.end(); } catch { /* ignore */ }
    });
  };
  const host = (process.env.SERVER_IP || '').trim();
  const cert = tls.load(host && host !== '0.0.0.0' ? host : 'localhost', tag);
  let app;
  if (cert) {
    // One port, two protocols: TLS handshakes go to HTTPS, plain HTTP gets a redirect to https://.
    app = https.createServer({ key: cert.key, cert: cert.cert, minVersion: 'TLSv1.2' }, onRequest);
    const redirect = http.createServer((req, res) => {
      const h = String(req.headers.host || '').replace(/[^\w.:[\]-]/g, '') || `localhost:${p}`;
      res.writeHead(301, { Location: `https://${h}${String(req.url || '/').startsWith('/') ? req.url : '/'}` });
      return res.end();
    });
    server = net.createServer((socket) => {
      socket.on('error', () => {});
      socket.setTimeout(15_000, () => socket.destroy());
      socket.once('data', (buf) => {
        socket.setTimeout(0);
        socket.pause();
        socket.unshift(buf);
        (buf[0] === 0x16 ? app : redirect).emit('connection', socket);
        process.nextTick(() => socket.resume());
      });
    });
    tlsActive = true;
    if (cert.selfSigned && cert.fingerprint) {
      console.log(`${tag} HTTPS (self-signed) SHA-256 fingerprint ${cert.fingerprint}`);
    }
  } else {
    app = http.createServer(onRequest);
    server = app;
  }
  app.keepAliveTimeout = 65_000;
  app.headersTimeout = 70_000;
  app.requestTimeout = 120_000;
  app.on('tlsClientError', () => { /* scanners / rejected self-signed cert */ });
  app.on('upgrade', (req, socket, head) => {
    socket.on('error', () => { /* client gone */ });
    onUpgrade(req, socket, head).catch(() => wsLite.reject(socket, 500, 'Internal Server Error'));
  });
  server.on('error', (err) => {
    console.warn(`${tag} Dashboard server error: ${err.message}`);
  });
  server.listen(p, process.env.WEB_HOST || '0.0.0.0', () => {
    console.log(`${tag} Dashboard on ${publicUrl()} (login: type "dashboard" in Discord, or password)`);
  });
  const tick = setInterval(broadcastTick, 2000);
  tick.unref?.();
  const ping = setInterval(() => {
    for (const c of sseClients) {
      try { c.res.write(': ping\n\n'); } catch { /* closed */ }
    }
  }, 25_000);
  ping.unref?.();
  server.on('close', () => { clearInterval(tick); clearInterval(ping); });
  return server;
}

function stop() {
  for (const c of sseClients) {
    try { c.res.end(); } catch { /* ignore */ }
  }
  sseClients.clear();
  metrics.stop();
  alerts.stop();
  try { require('./playStats').flush(); } catch { /* ignore */ }
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
}

/** Discord: an authorized user types "dashboard" (or ويب / داشبورد) → one-time login link by DM. */
function attachDiscord(client) {
  if (!enabled() || client._webDashboardAttached) return;
  client._webDashboardAttached = true;
  const { safeListener } = require('../util/safeListener');
  client.on('messageCreate', safeListener('[WEB]', async (message) => {
    if (message.author?.bot || !message.guild) return;
    const word = String(message.content || '').trim().toLowerCase();
    if (!DASHBOARD_WORDS.has(word)) return;
    if (auth.rateLimited(`cmd:${message.author.id}`, 3)) return;
    const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    const who = identity.fromMember(member);
    if (!who) return;
    try {
      await sendLoginDm(client, who);
      await message.react('📬').catch(() => {});
    } catch {
      await message.reply('❌ افتح الرسائل الخاصة (DM) من إعدادات الخصوصية ثم أعد المحاولة / Enable DMs and retry.').catch(() => {});
    }
  }));
}

module.exports = { start, stop, attachDiscord, publicUrl, _test: { refreshIdentity, resolveRole } };
