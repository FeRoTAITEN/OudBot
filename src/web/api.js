// api.js – dashboard JSON API (same powers as the Discord panels, plus health/logs/backups)
const path = require('path');
const { AudioPlayerStatus } = require('@discordjs/voice');
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const subsAdminStore = require('../subscription/subsAdminStore');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { getGuildMasterChannels } = require('../config/channels');
const { queueKeyForGuild } = require('../music/queueKey');
const { parseSlaveQueueKey } = require('../music/slaveQueueKey');
const logBuffer = require('./logBuffer');
const metrics = require('./metrics');
const auth = require('./auth');
const audit = require('./audit');
const alerts = require('./alerts');
const playStats = require('./playStats');
const { canAccessGuild, canManageSubs, isStaff, ownerIds, rootOwnerIds, isRootOwner, sectionLevel, serverStaff } = require('./identity');
const ownerStore = require('./ownerStore');
const adminView = require('./adminView');
const managerStore = require('./managerStore');
const memberAccess = require('./memberAccess');
const guildPerms = require('./guildPerms');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const startedAt = Date.now();
const boot = { masterReadyAt: null, slavesReadyAt: null };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const lazy = {
  MusicManager: () => require('../music/MusicManager'),
  globalVoice: () => require('../bots/globalVoice'),
};

function masterClient() {
  return registry.state.master?.client ?? null;
}

function requireOwner(ctx) {
  if (ctx.identity.role !== 'owner') throw new HttpError(403, 'owner only');
}

// T57: owner or manager.
function requireStaff(ctx) {
  if (!isStaff(ctx.identity)) throw new HttpError(403, 'owner or manager only');
}

// IPs are shown to the owner only (managers see logs with addresses masked).
// IPv4 first (also inside ::ffff:a.b.c.d), then IPv6: full form or any "::" form. Clock times (12:34:56) never match.
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_RE = /(?:[0-9a-f]{1,4}:){5,7}[0-9a-f]{1,4}|[0-9a-f]{0,4}(?::[0-9a-f]{1,4})*::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4})*)?/gi;
function maskIps(text) {
  return String(text).replace(IPV4_RE, '[ip]').replace(IPV6_RE, '[ip]');
}

function requireSubs(ctx) {
  if (!canManageSubs(ctx.identity)) throw new HttpError(403, 'subscription admins only');
}

function requireGuild(ctx, guildId) {
  if (!/^\d{17,20}$/.test(String(guildId))) throw new HttpError(400, 'bad guild id');
  if (!canAccessGuild(ctx.identity, guildId)) throw new HttpError(403, 'no access to this server');
}

// T81: server admins see / change a section only as the owner set it (adminView.js). Staff: always.
function requireSection(ctx, guildId, section, write = false) {
  const lvl = sectionLevel(ctx.identity, guildId, section);
  if (lvl === 'hide') throw new HttpError(403, 'hidden by the bot management');
  if (write && lvl !== 'show') throw new HttpError(403, 'view only');
}

function viewFor(ctx, guildId) {
  const out = {};
  for (const s of adminView.SECTIONS) out[s] = sectionLevel(ctx.identity, guildId, s);
  return out;
}

function guildIdForQueueKey(key) {
  const s = String(key);
  if (s.startsWith('guild:')) return s.slice(6);
  return parseSlaveQueueKey(s)?.guildId ?? null;
}

function iconOf(guild) {
  try { return guild?.iconURL?.({ size: 64 }) || null; } catch { return null; }
}

function wsPing(client) {
  const p = client?.ws?.ping;
  return Number.isFinite(p) && p >= 0 ? Math.round(p) : null;
}

// ---------- music snapshots ----------

function listQueues() {
  const MM = lazy.MusicManager();
  if (typeof MM.listQueues !== 'function') return [];
  return MM.listQueues();
}

function trackView(t) {
  if (!t) return null;
  const req = t.requester;
  return {
    title: t.title || 'Unknown',
    url: t.url || null,
    thumbnail: t.thumbnail || null,
    durationSec: t.durationSec || 0,
    requester: req ? { id: req.id ? String(req.id) : (typeof req === 'string' ? req : null), name: req.name || req.displayName || req.globalName || req.username || null } : null,
    playedAt: t.playedAt || null,
    platform: t.platform || null,
  };
}

function queueView(key, queue, { full = false } = {}) {
  const MM = lazy.MusicManager();
  const status = queue.player?.state?.status ?? 'none';
  let position = 0;
  try { position = Math.max(0, Math.floor(MM.getPlaybackPosition(queue) || 0)); } catch { /* ignore */ }
  const slave = parseSlaveQueueKey(key);
  const gid = guildIdForQueueKey(key);
  const vid = queue.voiceChannelId || null;
  return {
    key,
    guildId: gid,
    kind: slave ? 'slave' : 'master',
    slaveName: slave?.name ?? null,
    status,
    playing: status === AudioPlayerStatus.Playing,
    paused: status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused,
    current: trackView(queue.current),
    position,
    volume: queue.volume ?? 100,
    loop: queue.loop || 'none',
    filter: queue.activeFilter || 'none',
    autoDj: Boolean(queue.autoDj?.enabled),
    autoDjQuery: queue.autoDj?.query || null,
    autoDjMode: queue.autoDj?.mode || 'mood',
    canPlay: Boolean(queue.player),
    voiceChannelId: vid,
    webListeners: require('./webMix').counts()[gid] || 0,
    listeners: Array.isArray(queue.listeners) ? queue.listeners.length : 0,
    roomOwnerId: queue.roomOwnerId || null,
    length: queue.tracks.length,
    tracks: (full ? queue.tracks.slice(0, 200) : queue.tracks.slice(0, 5)).map(trackView),
    history: full ? (queue.history || []).slice(0, 20).map(trackView) : undefined,
  };
}

function activeStreams() {
  let n = 0;
  for (const [, q] of listQueues()) {
    if (q.current && q.player?.state?.status === AudioPlayerStatus.Playing) n++;
  }
  return n;
}

/** Subscribed guilds where the main bot should be in voice but is not (not paused, bot is a member). */
function voiceDownGuilds() {
  const client = masterClient();
  if (!client?.isReady?.()) return [];
  const gv = lazy.globalVoice();
  const out = [];
  for (const id of subscriptionStore.listGuildIds()) {
    const guild = client.guilds.cache.get(id);
    if (!guild || gv.isGuildVoicePaused(id)) continue;
    if (!getGuildMasterChannels(id).voiceChannelId) continue;
    if (gv.getEntry(id)?.connection?.state?.status !== 'ready') out.push(guild.name);
  }
  return out;
}

function voiceConnections() {
  let n = 0;
  const gv = lazy.globalVoice();
  for (const id of subscriptionStore.listGuildIds()) {
    if (gv.getEntry(id)?.connection?.state?.status === 'ready') n++;
  }
  for (const e of registry.state.slaves.values()) {
    if (e.connection?.state?.status === 'ready') n++;
  }
  return n;
}

// ---------- guilds ----------

function subscriptionView(guildId) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  const entry = subscriptionStore.getGuildEntry(guildId);
  return {
    exists: Boolean(entry),
    allowed: f.allowed,
    expired: f.expired,
    active: entry ? entry.active !== false : false,
    label: f.label || entry?.label || null,
    lifetime: entry ? subscriptionStore.isLifetimeEntry(entry) : false,
    expires: entry?.expires || null,
    music: f.music,
    bridge: f.bridge,
    slaves: f.slaves,
    autoRoom: f.autoRoom,
    editSlaveProfile: f.editSlaveProfile,
    webListen: f.webListen,
    maxSlaves: f.maxSlaves,
    labelLocked: Boolean(entry?.labelLocked),
    note: entry?.note || null,
    // T64: plan card for server admins (grace end after a timed plan ends, how to renew).
    graceUntil: (() => { const g = require('../config/mode').graceUntil(guildId); return g ? new Date(g).toISOString() : null; })(),
    contactUrl: process.env.DEFAULT_CONTACT_URL?.trim() || null,
  };
}

/** Server admins see their plan, not the subscription admins' private note. */
function forViewer(ctx, row) {
  if (canManageSubs(ctx.identity) || !row?.subscription) return row;
  return { ...row, subscription: { ...row.subscription, note: null } };
}

function guildRow(guildId) {
  const client = masterClient();
  const guild = client?.guilds?.cache?.get(guildId) ?? null;
  const gv = lazy.globalVoice();
  const ventry = gv.getEntry(guildId);
  const masterQ = lazy.MusicManager().getQueue ? listQueues().find(([k]) => k === queueKeyForGuild(guildId)) : null;
  const slaves = registry.getSlaveSnapshots(guildId);
  return {
    id: String(guildId),
    name: guild?.name || subscriptionStore.getGuildFeatures(guildId).label || String(guildId),
    icon: iconOf(guild),
    inGuild: Boolean(guild),
    memberCount: guild?.memberCount ?? null,
    ownerId: guild?.ownerId ?? null,
    subscription: subscriptionView(guildId),
    voice: {
      status: ventry?.connection?.state?.status ?? (gv.isGuildVoicePaused(guildId) ? 'paused' : 'none'),
      paused: gv.isGuildVoicePaused(guildId),
      channelId: ventry?.voiceChannelId || getGuildMasterChannels(guildId).voiceChannelId || null,
      bridge: Boolean(ventry?.bridgeRelay),
    },
    nowPlaying: masterQ?.[1]?.current ? trackView(masterQ[1].current) : null,
    slaves: slaves.length,
    slavesOnline: slaves.filter(s => s.connStatus === 'ready').length,
  };
}

function visibleGuildIds(ctx) {
  const ids = new Set(subscriptionStore.listAllGuildIds().map(String));
  const client = masterClient();
  const subs = canManageSubs(ctx.identity);
  if (subs && client) {
    for (const id of client.guilds.cache.keys()) ids.add(String(id));
  }
  return [...ids].filter(id => subs || canAccessGuild(ctx.identity, id));
}

function channelList(guild) {
  if (!guild) return { voice: [], text: [] };
  const voice = [];
  const text = [];
  for (const ch of guild.channels.cache.values()) {
    const row = { id: ch.id, name: ch.name, parent: ch.parent?.name || null, position: ch.rawPosition ?? 0 };
    if (ch.type === 2 || ch.type === 13) voice.push(row);
    else if (ch.type === 0 || ch.type === 5) text.push(row);
  }
  const sort = (a, b) => (a.parent || '').localeCompare(b.parent || '') || a.position - b.position;
  return { voice: voice.sort(sort), text: text.sort(sort) };
}

// ---------- handlers ----------

const AVATAR_HASH_RE = /^(a_)?[0-9a-f]{32}$/;

// Discord CDN avatar URL from a stored hash; falls back to the default avatar
// index (BigInt-shifted, safe for big ids); null when the id isn't numeric.
function avatarUrl(userId, hash) {
  const id = String(userId ?? '');
  if (!/^\d{1,20}$/.test(id)) return null;
  if (AVATAR_HASH_RE.test(String(hash ?? ''))) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
  const idx = Number(BigInt(id) >> 22n) % 6;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function me(ctx) {
  const identity = ctx.identity || {};
  return {
    identity,
    user: {
      id: identity.userId ?? null,
      name: identity.name ?? null,
      avatarUrl: avatarUrl(identity.userId, identity.avatar),
    },
    csrf: ctx.session.csrf,
    sessionId: ctx.session.id,
    rootOwner: isRootOwner(identity),
    initialPassword: Boolean(auth.loadAuth().initial),
  };
}

async function overview(ctx) {
  const client = masterClient();
  const guildIds = visibleGuildIds(ctx);
  const subs = subscriptionStore.listAllSummaries();
  const unknown = client
    ? [...client.guilds.cache.values()].filter(g => !subscriptionStore.getGuildEntry(g.id)).map(g => ({ id: g.id, name: g.name, icon: iconOf(g), memberCount: g.memberCount }))
    : [];
  const queues = listQueues()
    .filter(([k]) => canAccessGuild(ctx.identity, guildIdForQueueKey(k)))
    .filter(([, q]) => q.current)
    .map(([k, q]) => ({ ...queueView(k, q), guildName: guildRow(guildIdForQueueKey(k)).name }));
  return {
    bot: {
      tag: client?.user?.tag ?? null,
      avatar: client?.user?.displayAvatarURL?.({ size: 128 }) ?? null,
      ping: wsPing(client),
      ready: Boolean(client?.isReady?.()),
      uptimeSec: Math.round(process.uptime()),
      startedAt,
      node: process.version,
      boot,
    },
    counts: {
      guilds: guildIds.length,
      subscribed: subs.filter(s => s.allowed).length,
      expired: subs.filter(s => s.expired).length,
      slaves: registry.state.slaves.size,
      slavesOnline: [...registry.state.slaves.values()].filter(e => e.connection?.state?.status === 'ready').length,
      streams: activeStreams(),
      voice: voiceConnections(),
      ...logBuffer.counts(),
    },
    metrics: metrics.latest(),
    prefetch: require('../music/prefetch').stats(),
    stats: playStats.totals(),
    alerts: isStaff(ctx.identity) ? alerts.list() : [],
    audio: isStaff(ctx.identity) ? audioHealth() : [],
    warnings: isStaff(ctx.identity) ? {
      unknownGuilds: unknown,
      initialPassword: ctx.identity.role === 'owner' && process.env.WEB_PASSWORD_LOGIN === '1' && Boolean(auth.loadAuth().initial),
      unpaidAction: process.env.UNPAID_GUILD_ACTION || 'leave',
    } : null,
    nowPlaying: queues,
  };
}

function audioHealth() {
  let snap;
  try { snap = require('../bridge/bridgeDiag').snapshot(); } catch { snap = []; }
  const client = masterClient();
  const counts = require('./webMix').counts();
  return snap.map(s => ({ ...s, name: client?.guilds?.cache?.get(s.gid)?.name || s.gid, listeners: counts[s.gid] || 0 }));
}

async function guilds(ctx) {
  return visibleGuildIds(ctx).map((id) => forViewer(ctx, guildRow(id))).sort((a, b) => {
    if (a.subscription.allowed !== b.subscription.allowed) return a.subscription.allowed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function guildDetail(ctx, { id }) {
  // Subscription admins without server access: the subscription card only (no music, rooms, channels).
  if (/^\d{17,20}$/.test(String(id)) && !canAccessGuild(ctx.identity, id) && canManageSubs(ctx.identity)) {
    return { ...guildRow(id), access: 'subs', queues: [] };
  }
  requireGuild(ctx, id);
  const client = masterClient();
  const guild = client?.guilds?.cache?.get(id) ?? null;
  const row = forViewer(ctx, guildRow(id));
  const queues = listQueues()
    .filter(([k]) => guildIdForQueueKey(k) === id)
    .map(([k, q]) => queueView(k, q, { full: true }));
  const masterKey = queueKeyForGuild(id);
  if (!queues.some(q => q.key === masterKey)) {
    queues.unshift(queueView(masterKey, lazy.MusicManager().getQueue(masterKey), { full: true }));
  }
  const view = viewFor(ctx, id);
  const hidden = (s) => view[s] === 'hide';
  return {
    ...row,
    access: 'admin',
    view,
    serverStaff: serverStaff(ctx.identity, id),
    rooms: {
      master: guildChannelsStore.getMaster(id) || null,
      masterResolved: getGuildMasterChannels(id),
    },
    slaves: registry.getSlaveSnapshots(id),
    solo: safeCall(() => registry.getSoloSource(id), null),
    stats: hidden('stats') ? null : playStats.forGuild(id),
    queues,
    channels: channelList(guild),
    guests: hidden('guests') ? [] : require('./guestLinks').list(id),
  };
}

function safeCall(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

const SUB_FIELDS = {
  active: 'bool', music: 'bool', bridge: 'bool', slaves: 'bool', autoRoom: 'bool',
  editSlaveProfile: 'bool', lifetime: 'bool', labelLocked: 'bool', webListen: 'bool',
  maxSlaves: 'int', label: 'str', note: 'str', expires: 'date',
};

function cleanPatch(raw) {
  const patch = {};
  for (const [k, type] of Object.entries(SUB_FIELDS)) {
    if (!(k in (raw || {}))) continue;
    const v = raw[k];
    if (type === 'bool') patch[k] = Boolean(v);
    else if (type === 'int') {
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0 || n > 50) throw new HttpError(400, `${k} must be 0-50`);
      patch[k] = n;
    } else if (type === 'str') {
      patch[k] = v == null ? null : String(v).slice(0, k === 'note' ? 500 : 100);
    } else if (type === 'date') {
      if (v == null || v === '') patch[k] = null;
      else {
        const ms = Date.parse(String(v).includes('T') ? v : `${v}T23:59:59.000Z`);
        if (!Number.isFinite(ms)) throw new HttpError(400, 'bad expires date');
        patch[k] = new Date(ms).toISOString();
      }
    }
  }
  if (patch.lifetime === true) patch.expires = null;
  if (patch.expires) patch.lifetime = false;
  return patch;
}

async function auditToDiscord(ctx, text) {
  try {
    const { getAdminGuildId, getSubsAuditChannelId } = require('../subscription/adminConfig');
    const client = masterClient();
    const gid = getAdminGuildId();
    const chId = getSubsAuditChannelId();
    if (!client || !gid || !chId) return;
    const ch = client.guilds.cache.get(gid)?.channels?.cache?.get(chId);
    if (ch?.isTextBased?.()) await ch.send(`**[WEB]** ${ctx.identity.name}: ${text}`.slice(0, 1900)).catch(() => {});
  } catch { /* best effort */ }
}

// T74 (review S3): a server admin asks for a renewal; subscription admins get a note (audit channel,
// else a DM to the bot owners). Once per server per day.
const renewAskedAt = new Map();
async function renewRequest(ctx, { id }, body) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'plan', true);
  const last = renewAskedAt.get(id) || 0;
  if (Date.now() - last < 24 * 3600_000) throw new HttpError(429, 'already sent today');
  renewAskedAt.set(id, Date.now());
  const note = String(body?.note || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
  const f = subscriptionStore.getGuildFeatures(id);
  const client = masterClient();
  const name = client?.guilds?.cache?.get(id)?.name || f.label || id;
  const end = f.lifetime ? 'lifetime' : (f.expires ? String(f.expires).slice(0, 10) : '—');
  const text = `🔁 Renewal request — **${name}** (\`${id}\`) · ends ${end} · from ${ctx.identity.name} (<@${ctx.identity.userId}>)${note ? `\n> ${note}` : ''}`;
  let sent = false;
  try {
    const { getAdminGuildId, getSubsAuditChannelId } = require('../subscription/adminConfig');
    const ch = client?.guilds?.cache?.get(getAdminGuildId() || '')?.channels?.cache?.get(getSubsAuditChannelId() || '');
    if (ch?.isTextBased?.()) sent = await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
  } catch { /* fall back to DM */ }
  if (!sent) {
    for (const uid of ownerIds()) {
      const u = await client?.users?.fetch(uid).catch(() => null);
      if (u && await u.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).then(() => true).catch(() => false)) sent = true;
    }
  }
  audit.record(ctx, 'subscription.renewRequest', { guildId: id, sent });
  if (!sent) throw new HttpError(502, 'could not deliver the request');
  return { ok: true };
}

async function subscriptionAction(ctx, { id }, body) {
  requireSubs(ctx);
  if (!/^\d{17,20}$/.test(String(id))) throw new HttpError(400, 'bad guild id');
  const action = String(body?.action || '');
  let result;
  if (action === 'add') {
    const patch = cleanPatch(body.patch || {});
    const guild = masterClient()?.guilds?.cache?.get(id);
    if (!patch.label && guild?.name) patch.label = guild.name;
    result = subscriptionStore.upsertGuild(id, patch);
    if (!result) throw new HttpError(400, 'could not add');
    audit.record(ctx, 'subscription.add', { guildId: id, patch });
    void auditToDiscord(ctx, `added subscription ${patch.label || id} (${id})`);
  } else if (action === 'patch') {
    const patch = cleanPatch(body.patch || {});
    if (!subscriptionStore.getGuildEntry(id)) throw new HttpError(404, 'no subscription');
    result = subscriptionStore.mergeGuild(id, patch);
    audit.record(ctx, 'subscription.patch', { guildId: id, patch });
    void auditToDiscord(ctx, `updated ${id}: ${Object.keys(patch).join(', ')}`);
  } else if (action === 'extend') {
    const days = parseInt(body.days, 10);
    if (!Number.isFinite(days) || days < 1 || days > 3650) throw new HttpError(400, 'days 1-3650');
    const entry = subscriptionStore.getGuildEntry(id);
    if (!entry) throw new HttpError(404, 'no subscription');
    const base = Math.max(Date.now(), Date.parse(entry.expires || '') || 0);
    const expires = new Date(base + days * 86400_000).toISOString();
    result = subscriptionStore.mergeGuild(id, { expires, lifetime: false, active: true });
    audit.record(ctx, 'subscription.extend', { guildId: id, days, expires });
    void auditToDiscord(ctx, `extended ${id} by ${days} day(s) → ${expires.slice(0, 10)}`);
  } else if (action === 'remove') {
    if (body.confirm !== id) throw new HttpError(400, 'confirm must equal the guild id');
    result = subscriptionStore.removeGuild(id);
    audit.record(ctx, 'subscription.remove', { guildId: id });
    void auditToDiscord(ctx, `removed subscription ${id}`);
  } else {
    throw new HttpError(400, 'unknown action');
  }
  return { ok: true, subscription: subscriptionView(id), result: Boolean(result) };
}

async function leaveGuild(ctx, { id }, body) {
  requireOwner(ctx);
  if (body?.confirm !== id) throw new HttpError(400, 'confirm must equal the guild id');
  const guild = masterClient()?.guilds?.cache?.get(id);
  if (!guild) throw new HttpError(404, 'bot is not in this server');
  await guild.leave();
  audit.record(ctx, 'guild.leave', { guildId: id, name: guild.name });
  void auditToDiscord(ctx, `left server ${guild.name} (${id})`);
  return { ok: true };
}

async function voiceAction(ctx, { id }, body) {
  // T68: server admins too (the Rooms tab shows these buttons to them; the Discord panel already lets them).
  requireGuild(ctx, id);
  requireSection(ctx, id, 'voice', true);
  const gv = lazy.globalVoice();
  const action = String(body?.action || '');
  if (action === 'pause') gv.pauseGuildVoice(id, '[WEB]');
  else if (action === 'resume') {
    // Was resumeGuildVoice(id, tag): the guild id went in the client slot, so resume never cleared the pause.
    await gv.resumeGuildVoice(masterClient(), id, '[WEB]').catch(() => {});
  } else if (action === 'rejoin') {
    const { repairGuildMasterRoom } = require('../subscription/guildRoomRecovery');
    gv.destroyGuildVoice(id);
    await new Promise(r => setTimeout(r, 1200));
    await repairGuildMasterRoom(masterClient(), id, '[WEB]');
  } else throw new HttpError(400, 'unknown action');
  audit.record(ctx, `voice.${action}`, { guildId: id });
  return { ok: true, voice: guildRow(id).voice };
}

async function setRooms(ctx, { id }, body) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'rooms', true);
  const guild = masterClient()?.guilds?.cache?.get(id);
  if (!guild) throw new HttpError(404, 'bot is not in this server');
  const patch = {};
  for (const k of ['voiceChannelId', 'textChannelId']) {
    if (!(k in (body || {}))) continue;
    const v = body[k] ? String(body[k]) : null;
    if (v && !guild.channels.cache.has(v)) throw new HttpError(400, `${k} not found in this server`);
    patch[k] = v;
  }
  guildChannelsStore.mergeMaster(id, patch);
  audit.record(ctx, 'rooms.master', { guildId: id, patch });
  return { ok: true, rooms: getGuildMasterChannels(id) };
}

// ---------- member permissions (T25) ----------

function roleList(guild) {
  if (!guild) return [];
  return [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .slice(0, 250)
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor || null }));
}

async function getPerms(ctx, { id }) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'perms');
  const guild = masterClient()?.guilds?.cache?.get(id) ?? null;
  const settings = guildPerms.get(id);
  const names = {};
  for (const uid of [...settings.djUserIds, ...settings.bannedUserIds].slice(0, 100)) {
    const m = guild ? (guild.members.cache.get(uid) ?? await guild.members.fetch(uid).catch(() => null)) : null;
    if (m) names[uid] = m.displayName || m.user?.username || uid;
  }
  return { settings, defaults: guildPerms.DEFAULTS, limits: guildPerms.LIMITS, roles: roleList(guild), names };
}

async function setPerms(ctx, { id }, body) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'perms', true);
  const settings = guildPerms.set(id, body?.patch);
  audit.record(ctx, 'guild.perms', { guildId: id, patch: body?.patch });
  return { ok: true, settings };
}

/** "Test permission": a user's level + allowed actions in each active room of this server. */
async function testPerms(ctx, { id }, _b, query) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'perms');
  const userId = String(query.get('user') || '').trim();
  if (!/^\d{17,20}$/.test(userId)) throw new HttpError(400, 'bad user id');
  const guild = masterClient()?.guilds?.cache?.get(id);
  if (!guild) throw new HttpError(404, 'bot is not in this server');
  const member = await memberAccess.memberOf(guild, userId);
  if (!member) throw new HttpError(404, 'user is not in this server');
  const perms = guildPerms.get(id);
  const rooms = [];
  for (const [k, q] of listQueues()) {
    if (guildIdForQueueKey(k) !== id) continue;
    const level = await memberAccess.levelFor({ userId }, guild, q);
    const ch = q.voiceChannelId ? guild.channels.cache.get(q.voiceChannelId) : null;
    rooms.push({ key: k, channelName: ch?.name || null, level, actions: memberAccess.actionsFor(level, perms) });
  }
  return { user: { id: userId, name: member.displayName || member.user?.username || userId }, rooms };
}

/** Member search for the perms pickers (owner + server admins). */
async function guildMembers(ctx, { id }, _b, query) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'perms');
  const q = String(query.get('q') || '').trim().slice(0, 32);
  if (!q) throw new HttpError(400, 'empty query');
  if (auth.rateLimited(`gmsearch:${ctx.identity.userId || ctx.ip}`, 30, 60_000)) throw new HttpError(429, 'too many searches');
  const guild = masterClient()?.guilds?.cache?.get(id);
  if (!guild) throw new HttpError(404, 'bot is not in this server');
  const low = q.toLowerCase();
  const found = new Map();
  for (const m of guild.members.cache.values()) {
    const names = [m.displayName, m.user?.username, m.user?.globalName].filter(Boolean).map(s => s.toLowerCase());
    if (m.id === q || names.some(n => n.includes(low))) found.set(m.id, m);
    if (found.size >= 10) break;
  }
  if (found.size < 10 && q.length >= 2) {
    const more = await guild.members.search({ query: q, limit: 10 }).catch(() => null);
    for (const m of more?.values?.() || []) if (found.size < 10) found.set(m.id, m);
  }
  const members = [...found.values()].map(m => ({ id: m.id, name: m.displayName || m.user?.username || m.id, username: m.user?.username || null, avatar: m.displayAvatarURL?.({ size: 64 }) || null, bot: Boolean(m.user?.bot) }));
  members.sort((a, b) => Number(a.bot) - Number(b.bot));
  return { members };
}

// ---------- queues ----------

function getQueueForCtx(ctx, key) {
  const gid = guildIdForQueueKey(key);
  if (!gid) throw new HttpError(400, 'bad queue key');
  requireGuild(ctx, gid);
  const MM = lazy.MusicManager();
  return { MM, queue: MM.getQueue(key), guildId: gid };
}

// T24: full access (owner/admin) -> level 'admin'; plain members -> live level for this room.
async function queueAccess(ctx, key) {
  const gid = guildIdForQueueKey(key);
  if (!gid || !/^\d{17,20}$/.test(gid)) throw new HttpError(400, 'bad queue key');
  const MM = lazy.MusicManager();
  if (canAccessGuild(ctx.identity, gid) && sectionLevel(ctx.identity, gid, 'music') === 'show') {
    return { MM, queue: MM.getQueue(key), guildId: gid, level: 'admin' };
  }
  if (!memberAccess.canViewGuild(ctx.identity, gid)) throw new HttpError(403, 'no access to this server');
  // Never create a queue for a member: only rooms that already exist.
  if (!listQueues().some(([k]) => k === key)) throw new HttpError(404, 'room not active');
  const queue = MM.getQueue(key);
  const guild = masterClient()?.guilds?.cache?.get(gid) ?? queue.guild ?? null;
  const level = await memberAccess.levelFor(ctx.identity, guild, queue);
  return { MM, queue, guildId: gid, level, guild };
}

function withAccess(view, level) {
  return { ...view, my: { level, actions: memberAccess.actionsFor(level, guildPerms.get(view.guildId)) } };
}

/** T24: rooms the user can see (member guilds + admin guilds) with their level per room. */
async function rooms(ctx) {
  const client = masterClient();
  const out = [];
  const gids = new Set([...(ctx.identity.guilds || []), ...(ctx.identity.memberGuilds || [])].map(String));
  for (const gid of gids) {
    if (!memberAccess.canViewGuild(ctx.identity, gid)) continue;
    const guild = client?.guilds?.cache?.get(gid);
    if (!guild) continue;
    const list = [];
    for (const [k, q] of listQueues()) {
      if (guildIdForQueueKey(k) !== gid || !q.player) continue;
      const level = canAccessGuild(ctx.identity, gid) ? 'admin' : await memberAccess.levelFor(ctx.identity, guild, q);
      const ch = q.voiceChannelId ? guild.channels.cache.get(q.voiceChannelId) : null;
      list.push({ ...withAccess(queueView(k, q), level), channelName: ch?.name || null });
    }
    out.push({ id: gid, name: guild.name, icon: iconOf(guild), rooms: list });
  }
  return { guilds: out };
}

/**
 * "Now" page. room = the room you are in (here: true), else the first playing room (of ?g= when given).
 * Context server (room's, or ?g=): other bots/rooms there, recent activity of the room, play stats.
 * servers = every server you share with the bot, with your level (Servers page for non-owners).
 */
async function now(ctx, _params, _body, query) {
  const client = masterClient();
  const id = ctx.identity;
  const uid = id.userId ? String(id.userId) : null;
  const owner = isStaff(id);
  const want = String(query?.get?.('g') || '');
  const gids = owner
    ? [...(client?.guilds?.cache?.keys() || [])].map(String)
    : [...new Set([...(id.guilds || []), ...(id.memberGuilds || [])].map(String))];
  const ctxs = new Map();
  let here = null;
  let inVoice = null;
  const servers = [];
  for (const gid of gids) {
    if (!owner && !memberAccess.canViewGuild(id, gid)) continue;
    const guild = client?.guilds?.cache?.get(gid);
    if (!guild) continue;
    const member = uid ? await memberAccess.memberOf(guild, uid) : null;
    if (owner && uid && !member) continue; // owner: only servers they are in (password session: all)
    const admin = canAccessGuild(id, gid);
    const vc = member?.voice?.channelId || null;
    const rooms = [];
    for (const [k, q] of listQueues()) {
      if (guildIdForQueueKey(k) !== gid || !q.player) continue;
      const level = admin ? 'admin' : memberAccess.levelForMember(member, guild, q);
      const ch = q.voiceChannelId ? guild.channels.cache.get(q.voiceChannelId) : null;
      const roomOwner = q.roomOwnerId ? guild.members.cache.get(String(q.roomOwnerId)) : null;
      const view = {
        ...withAccess(queueView(k, q), level),
        channelName: ch?.name || null,
        guildName: guild.name,
        roomOwnerName: roomOwner ? (roomOwner.displayName || roomOwner.user?.username || null) : null,
      };
      rooms.push({ view, queue: q });
      if (vc && q.voiceChannelId === vc && !here) here = { gid, key: k };
    }
    if (vc && !rooms.some(r => r.view.voiceChannelId === vc)) inVoice = { guildName: guild.name, channelName: guild.channels.cache.get(vc)?.name || null };
    ctxs.set(gid, { guild, admin, rooms });
    const level = admin ? 'admin' : memberAccess.levelForMember(member, guild, null);
    servers.push({ id: gid, name: guild.name, icon: iconOf(guild), level, settings: admin, playing: rooms.filter(r => r.queue.current).length });
  }
  servers.sort((a, b) => (b.playing - a.playing) || (Number(b.settings) - Number(a.settings)) || a.name.localeCompare(b.name));

  // Focus room and context server.
  let gid = null;
  let focus = null;
  if (want && ctxs.has(want)) {
    gid = want;
    focus = (here?.gid === want && ctxs.get(want).rooms.find(r => r.view.key === here.key))
      || ctxs.get(want).rooms.find(r => r.queue.current) || null;
  } else if (here) {
    gid = here.gid;
    focus = ctxs.get(gid).rooms.find(r => r.view.key === here.key);
  } else {
    for (const s of servers) {
      const r = ctxs.get(s.id).rooms.find(x => x.queue.current);
      if (r) { gid = s.id; focus = r; break; }
    }
    if (!gid && servers.length) gid = servers[0].id;
  }
  const c = gid ? ctxs.get(gid) : null;
  let room = null;
  let activity = null;
  if (focus) {
    const full = queueView(focus.view.key, focus.queue, { full: true });
    room = { ...focus.view, tracks: full.tracks, here: Boolean(here && here.key === focus.view.key) };
    const actions = audit.list(300)
      .filter(e => e.details?.key === focus.view.key && String(e.action).startsWith('queue.'))
      .slice(0, 8)
      .map(e => ({ ts: e.ts, user: e.user || null, action: String(e.action).slice(6), via: e.details?.via || null }));
    const activitySongs = (full.history || [])
      .filter(tr => tr.url !== focus.queue.current?.url)
      .slice(0, 8)
      .map(tr => ({ title: tr.title, url: tr.url, thumbnail: tr.thumbnail || null, playedAt: tr.playedAt || null, requester: tr.requester?.name || null, durationSec: tr.durationSec || 0 }));
    activity = { songs: activitySongs, actions };
  }
  let others = [];
  let stats = null;
  if (c) {
    others = c.rooms.filter(r => r.view.key !== focus?.view.key).map(r => r.view);
    const busy = new Set(c.rooms.map(r => r.view.key));
    for (const s of registry.getSlaveSnapshots(gid)) {
      if (busy.has(s.queueKey)) continue;
      const ch = s.channelId ? c.guild.channels.cache.get(s.channelId) : null;
      others.push({ key: s.queueKey, kind: 'slave', slaveName: s.name, channelName: ch?.name || null, status: s.connStatus, current: null, idle: true });
    }
    const st = playStats.forGuild(gid);
    const today = st.days.length ? st.days[st.days.length - 1] : { plays: 0, seconds: 0 };
    stats = {
      plays: st.plays || 0,
      todayPlays: today.plays || 0,
      todaySeconds: today.seconds || 0,
      topTracks: st.topTracks.slice(0, 5).map(t => ({ title: t.title, url: t.url, count: t.count })),
      topDjs: st.topDjs.slice(0, 5).map(d => ({ name: d.name, count: d.count })),
    };
  }
  const elsewhere = [];
  for (const [sid, cx] of ctxs) {
    if (sid === gid) continue;
    for (const r of cx.rooms) {
      if (!r.queue.current || elsewhere.length >= 12) continue;
      elsewhere.push({ guildId: sid, guildName: cx.guild.name, icon: iconOf(cx.guild), key: r.view.key, channelName: r.view.channelName, title: r.view.current?.title || null, thumbnail: r.view.current?.thumbnail || null, listeners: r.view.listeners || 0 });
    }
  }
  return {
    room,
    elsewhere,
    inVoice: room?.here ? null : inVoice,
    guild: c ? { id: gid, name: c.guild.name, icon: iconOf(c.guild), settings: c.admin } : null,
    others,
    activity,
    stats,
    servers,
  };
}

async function queuePlaylists(ctx, { key }) {
  const { MM } = getQueueForCtx(ctx, key);
  const playlists = (MM.getSavedPlaylists(key) || []).map((p) => ({ name: p.displayName, count: p.count }));
  return { playlists };
}

async function queueDetail(ctx, { key }) {
  const { queue, level } = await queueAccess(ctx, key);
  return withAccess(queueView(key, queue, { full: true }), level);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function requesterOf(ctx) {
  return { id: ctx.identity.userId || 'web', username: ctx.identity.name || 'Dashboard', displayName: ctx.identity.name || 'Dashboard' };
}

async function resolveQueryToTrack(MM, query, requester) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new HttpError(400, 'empty query');
  if (/^https?:\/\//i.test(q)) {
    const { isSafeMediaUrl } = require('../music/linkMeta');
    if (!isSafeMediaUrl(q)) throw new HttpError(400, 'blocked url');
    const { resolveTrackMetadata } = require('../music/youtubeMeta');
    const t = await resolveTrackMetadata({ url: q, title: q });
    return { ...t, requester };
  }
  const yts = require('../music/youtubeSearch');
  const res = await yts(q);
  const v = res?.videos?.[0];
  if (!v) throw new HttpError(404, 'no results');
  return MM.videoToTrack(v, requester);
}

// A queue started from the web has no chat yet (it is set by the first Discord command); use the
// voice room's own chat so the music panel shows in Discord the same way.
function attachRoomChat(queue, guild) {
  if (queue.textChannel) return;
  const g = guild || queue.guild;
  const vcId = String(queue.voiceChannelId || queue.connection?.joinConfig?.channelId || '');
  const vc = g?.channels?.cache?.get(vcId);
  if (!vc?.isTextBased?.()) return;
  queue.textChannel = vc;
  if (!queue.guild) queue.guild = g;
  if (!queue.voiceChannelId) queue.voiceChannelId = vc.id;
}

async function queueAction(ctx, { key }, body) {
  const { MM, queue, guildId, level } = await queueAccess(ctx, key);
  const guild = masterClient()?.guilds?.cache?.get(guildId) ?? queue.guild ?? null;
  const action = String(body?.action || '');
  const perms = level === 'admin' ? null : guildPerms.get(guildId);
  let hist = null;
  if (body?.fromHistory) {
    const historyStore = require('../music/historyStore');
    const found = historyStore.list(key).find(t => t.url === String(body.fromHistory)) || null;
    if (!found) throw new HttpError(404, 'not in history');
    hist = found;
  }
  if (perms) {
    if (!memberAccess.can(level, action, perms)) throw new HttpError(403, `not allowed for ${level}`);
    if (action === 'play') {
      if (!perms.allowLinks && !body.fromHistory && /^https?:\/\//i.test(String(body.query || '').trim())) throw new HttpError(403, 'links are disabled on this server');
      if (auth.rateLimited(`mplay:${guildId}:${ctx.identity.userId}`, perms.playPerMin, 60_000)) {
        throw new HttpError(429, 'too many songs, wait a minute');
      }
    }
    if (action === 'skip' && level === 'listener') {
      // Listeners vote, like the Discord skip button.
      if (!queue.current) throw new HttpError(409, 'nothing playing');
      const member = await memberAccess.memberOf(guild, ctx.identity.userId);
      const r = await MM._resolveVoteSkip(member, guild, queue, key);
      audit.record(ctx, 'queue.voteskip', { key });
      return { ok: true, vote: { skipped: Boolean(r?.skipped), message: r?.content || null }, queue: withAccess(queueView(key, queue, { full: true }), level) };
    }
  }
  const player = queue.player;
  const refresh = () => MM.updateNowPlaying(key, guild).catch(() => {});
  let extra = {};

  switch (action) {
    case 'pause':
      if (player?.state?.status === AudioPlayerStatus.Playing) {
        player.pause();
        if (queue.current) queue.current.pausedAt = Date.now();
      }
      break;
    case 'resume':
      if (queue.current?.pausedAt) {
        queue.current.startedAt += Date.now() - queue.current.pausedAt;
        queue.current.pausedAt = null;
      }
      player?.unpause();
      break;
    case 'skip':
      MM.skipCurrent(queue, key);
      break;
    case 'stop':
      await MM.stopPlayback(queue, key, guild);
      break;
    case 'shuffle':
      shuffleArray(queue.tracks);
      break;
    case 'loop': {
      const v = String(body.value || '');
      if (['none', 'queue', 'track'].includes(v)) queue.loop = v;
      else MM.cycleLoop(queue);
      break;
    }
    case 'volume': {
      const v = parseInt(body.value, 10);
      if (!Number.isFinite(v)) throw new HttpError(400, 'bad volume');
      extra.volume = MM.setMusicVolume(queue, Math.min(v, memberAccess.volumeCap(level, guildPerms.get(guildId))));
      break;
    }
    case 'seek': {
      if (!queue.current) throw new HttpError(409, 'nothing playing');
      const to = Math.max(0, parseInt(body.to, 10) || 0);
      await MM.replayCurrentTrack(key, { startSec: to });
      break;
    }
    case 'filter': {
      const { FILTER_PRESETS } = require('../music/musicUI');
      const f = String(body.value || 'none');
      if (!FILTER_PRESETS[f]) throw new HttpError(400, 'unknown filter');
      MM.setFilter(queue, f);
      if (queue.current) await MM.restartCurrentWithFilter(key);
      break;
    }
    case 'remove': {
      const removed = MM.removeFromQueue(queue, parseInt(body.index, 10));
      if (!removed) throw new HttpError(400, 'bad index');
      break;
    }
    case 'move': {
      const r = MM.moveQueueTrack(queue, parseInt(body.index, 10), body.direction === 'up' ? 'up' : 'down');
      if (r == null) throw new HttpError(400, 'bad index');
      break;
    }
    case 'jump': {
      const r = MM.jumpToQueueTrack(queue, key, parseInt(body.index, 10));
      if (!r) throw new HttpError(400, 'bad index');
      if (r.needsStart) await MM.schedulePlayNext(key);
      break;
    }
    case 'clear':
      queue.tracks.length = 0;
      break;
    case 'autodj':
      queue.autoDj = { ...(queue.autoDj || {}), enabled: Boolean(body.enabled), query: String(body.query || queue.autoDj?.query || 'lofi hip hop').slice(0, 100) };
      if (queue.autoDj.enabled && !queue.current) { attachRoomChat(queue, guild); MM.maybeStartAutoDj(key); }
      break;
    case 'play': {
      if (!player) throw new HttpError(409, 'bot is not connected to voice in this room');
      attachRoomChat(queue, guild);
      const { streamingPlatform } = require('../music/streamingLinks');
      if (!hist && streamingPlatform(String(body.query || '').trim())) {
        // Spotify/Apple/Deezer/...: first match plays now, the rest are added in the background.
        const first = await MM.loadStreamingLink(queue, String(body.query).trim(), requesterOf(ctx), null, player, key)
          .catch((err) => { throw new HttpError(err.code === 'NO_MATCH' ? 404 : 502, String(err.message || err).slice(0, 200)); });
        if (!first) throw new HttpError(404, 'no match');
        if (queue.current) await MM.sendNowPlaying(key, guild).catch(() => {});
        extra.added = trackView(first);
        break;
      }
      const track = hist
        ? { title: hist.title, url: hist.url, thumbnail: hist.thumbnail || '', durationSec: hist.durationSec || 0, requester: requesterOf(ctx) }
        : await resolveQueryToTrack(MM, body.query, requesterOf(ctx));
      if (perms?.maxTrackMin && Number(track.durationSec) > perms.maxTrackMin * 60) {
        throw new HttpError(400, `song is longer than ${perms.maxTrackMin} min`);
      }
      const res = MM.enqueueTracks(queue, [track], requesterOf(ctx), key, { limits: Boolean(perms) });
      const { added } = res;
      if (!added.length) {
        if (res.overMine) throw new HttpError(409, `you already have ${perms.maxQueuedPerMember} song(s) waiting`);
        throw new HttpError(409, queue.tracks.length >= MM.MAX_QUEUE ? `queue is full (${MM.MAX_QUEUE} songs)` : 'already in queue');
      }
      if (body.next && queue.tracks.length > 1) {
        const i = queue.tracks.indexOf(added[0]);
        if (i > 0) { queue.tracks.splice(i, 1); queue.tracks.unshift(added[0]); }
      }
      await MM.afterEnqueueThenNowPlaying(key, guild);
      extra.added = trackView(added[0]);
      break;
    }
    case 'moveto': {
      const index = parseInt(body.index, 10);
      const to = parseInt(body.to, 10);
      if (!Number.isInteger(index) || !Number.isInteger(to)
        || index < 1 || index > queue.tracks.length || to < 1 || to > queue.tracks.length) {
        throw new HttpError(400, 'bad index');
      }
      const [track] = queue.tracks.splice(index - 1, 1);
      queue.tracks.splice(to - 1, 0, track);
      break;
    }
    case 'autodjmode': {
      const mode = String(body.mode || '');
      if (mode === 'similar') {
        queue.autoDj = { ...(queue.autoDj || {}), mode: 'similar' };
      } else if (mode === 'mood') {
        queue.autoDj = { ...(queue.autoDj || {}), mode: 'mood' };
        if (typeof body.query === 'string' && body.query.length) queue.autoDj.query = body.query.slice(0, 100);
      } else throw new HttpError(400, 'bad mode');
      break;
    }
    case 'loadpl': {
      const playlistStore = require('../music/playlistStore');
      const entry = playlistStore.getEntry(key, String(body.name || ''));
      if (!entry?.tracks?.length) throw new HttpError(404, 'playlist not found');
      if (!player) throw new HttpError(409, 'bot is not connected to voice in this room');
      MM.enqueueTracks(queue, entry.tracks, requesterOf(ctx), key, { limits: Boolean(perms) });
      await MM.afterEnqueueThenNowPlaying(key, guild);
      break;
    }
    case 'savepl': {
      const playlistStore = require('../music/playlistStore');
      const name = String(body.name || '').trim();
      if (name.length < 1 || name.length > 50) throw new HttpError(400, 'bad name');
      const { tracks } = MM.collectForSave(queue);
      const { count } = playlistStore.save(key, name, tracks);
      extra.saved = { name, count };
      break;
    }
    default:
      throw new HttpError(400, 'unknown action');
  }
  if (action !== 'stop') void refresh();
  audit.record(ctx, `queue.${action}`, { key, ...(body.value != null ? { value: body.value } : {}), ...(hist ? { query: String(hist.title).slice(0, 120), replay: true } : body.query ? { query: String(body.query).slice(0, 120) } : {}) });
  return { ok: true, ...extra, queue: withAccess(queueView(key, queue, { full: true }), level) };
}

async function search(ctx, _params, _body, query) {
  const q = String(query.get('q') || '').trim().slice(0, 200);
  if (!q) return [];
  if (ctx.identity.role === 'member' && auth.rateLimited(`msearch:${ctx.identity.userId}`, 20, 60_000)) throw new HttpError(429, 'slow down');
  const yts = require('../music/youtubeSearch');
  const res = await yts(q);
  return (res?.videos || []).slice(0, 10).map(v => ({
    title: v.title,
    url: v.url,
    thumbnail: v.thumbnail || v.image,
    duration: v.timestamp || null,
    author: v.author?.name || null,
  }));
}

// ---------- guest links ----------

async function guestLinks(ctx, { id }) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'guests');
  return { links: require('./guestLinks').list(id), webListen: Boolean(subscriptionStore.getGuildFeatures(id).webListen) };
}

async function guestAction(ctx, { id }, body) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'guests', true);
  const gl = require('./guestLinks');
  const action = String(body?.action || '');
  if (action === 'create') {
    if (!subscriptionStore.getGuildFeatures(id).webListen) throw new HttpError(400, 'web listening is off');
    const r = gl.create(id, { hours: body.hours, label: body.label, by: ctx.identity.userId, byName: ctx.identity.name });
    if (r.error) throw new HttpError(400, r.error);
    audit.record(ctx, 'guest.create', { guildId: String(id), id: r.link.id, exp: r.link.exp });
    return { token: r.token, link: r.link, links: gl.list(id) };
  }
  if (action === 'revoke') {
    const lid = String(body?.linkId || '');
    if (!gl.revoke(id, lid)) throw new HttpError(404, 'no such link');
    gl.closeAll(lid);
    audit.record(ctx, 'guest.revoke', { guildId: String(id), id: lid });
    return { links: gl.list(id) };
  }
  throw new HttpError(400, 'unknown action');
}

// ---------- bridge ----------

async function bridgeAction(ctx, { id }, body) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'bridge', true);
  const action = String(body?.action || '');
  const room = body.room != null ? String(body.room) : null;
  switch (action) {
    case 'mute': registry.toggleBridgeMute(room, id); break;
    case 'solo': registry.setBridgeSoloFromSelect(room || 'off', id); break;
    case 'enable': registry.toggleBridgeEnabled(room, id); break;
    case 'usermute': {
      // T67: mute one person on the bridge (same as the Discord panel's person mute).
      const user = String(body.user || '');
      if (!/^\d{17,20}$/.test(user) || !room) throw new HttpError(400, 'bad user');
      const { makeUserSourceKey } = require('../bridge/sourceKey');
      registry.toggleUserBridgeMute(makeUserSourceKey(room, user, id));
      break;
    }
    case 'volume': {
      const v = parseInt(body.value, 10);
      if (!Number.isFinite(v) || v < 0 || v > 200) throw new HttpError(400, 'volume 0-200');
      if (typeof registry.setBridgeVolumeAbsolute === 'function') registry.setBridgeVolumeAbsolute(room, v, id);
      break;
    }
    default: throw new HttpError(400, 'unknown action');
  }
  audit.record(ctx, `bridge.${action}`, { guildId: id, room, value: body.value });
  return { ok: true, slaves: registry.getSlaveSnapshots(id), solo: safeCall(() => registry.getSoloSource(id), null) };
}

// T68 (review P1): room bot voice controls from the dashboard (staff, and server admins for their server).
async function roomBotAction(ctx, { id }, body) {
  requireGuild(ctx, id);
  requireSection(ctx, id, 'roomBots', true);
  const name = String(body?.name || '');
  const action = String(body?.action || '');
  const entry = registry.getSlaveEntry(id, name);
  if (!entry || String(entry.cfg?.guildId) !== String(id)) throw new HttpError(404, 'room bot not found');
  const voice = entry.voice;
  if (!voice) throw new HttpError(409, 'room bot is not ready');
  if (action === 'pause') voice.pause();
  else if (action === 'resume') await voice.resume();
  else if (action === 'reconnect') {
    if (voice.isPaused()) throw new HttpError(409, 'room bot is paused — resume it first');
    if (typeof entry.reconnect === 'function') entry.reconnect();
    else voice.scheduleRejoin('dashboard reconnect', { force: true });
  } else throw new HttpError(400, 'unknown action');
  audit.record(ctx, `roombot.${action}`, { guildId: id, name });
  return { ok: true, slaves: registry.getSlaveSnapshots(id) };
}

// ---------- bots ----------

async function bots(ctx) {
  const client = masterClient();
  const byClient = new Map();
  for (const e of registry.state.slaves.values()) {
    if (!e.client?.user) continue;
    if (!isStaff(ctx.identity) && !canAccessGuild(ctx.identity, e.cfg?.guildId)) continue;
    const id = e.client.user.id;
    if (!byClient.has(id)) {
      byClient.set(id, {
        id,
        tag: e.client.user.tag,
        avatar: e.client.user.displayAvatarURL?.({ size: 64 }) ?? null,
        ping: wsPing(e.client),
        guilds: e.client.guilds.cache.size,
        deployments: [],
      });
    }
    byClient.get(id).deployments.push({
      guildId: e.cfg?.guildId,
      name: e.name,
      voice: e.connection?.state?.status ?? 'offline',
      player: e.player?.state?.status ?? 'none',
    });
  }
  let pool = [];
  if (isStaff(ctx.identity)) {
    try {
      pool = require('../config/slavePoolStore').listPoolBots().map(b => ({ id: b.id, label: b.label, clientId: b.clientId, inviteUrl: b.inviteUrl }));
    } catch { /* ignore */ }
  }
  return {
    master: client?.user ? {
      id: client.user.id,
      tag: client.user.tag,
      avatar: client.user.displayAvatarURL?.({ size: 64 }) ?? null,
      ping: wsPing(client),
      guilds: client.guilds.cache.size,
    } : null,
    slaves: [...byClient.values()],
    pool,
  };
}

// ---------- health / logs / backups / admin ----------

async function metricsHistory(ctx, _p, _b, query) {
  const points = Math.min(720, Math.max(10, parseInt(query.get('points') || '180', 10) || 180));
  return metrics.getHistory(points);
}

async function logs(ctx, _p, _b, query) {
  requireStaff(ctx);
  const out = logBuffer.query({
    level: query.get('level') || null,
    q: query.get('q') || '',
    sinceId: parseInt(query.get('since') || '0', 10) || 0,
    limit: Math.min(2000, parseInt(query.get('limit') || '500', 10) || 500),
  });
  return ctx.identity.role === 'owner' ? out : out.map(e => ({ ...e, text: maskIps(e.text) }));
}

async function backups(ctx) {
  requireStaff(ctx); // T81: managers too (list + back up now); T82: owners restore
  const fs = require('fs');
  const root = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse().map(n => {
    let files = 0;
    let bytes = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else { files++; bytes += fs.statSync(p).size; }
      }
    };
    try { walk(path.join(root, n)); } catch { /* ignore */ }
    return { date: n, files, bytes };
  });
}

async function runBackupNow(ctx) {
  requireStaff(ctx);
  const { runBackup } = require('../util/dataBackup');
  const r = runBackup(DATA_DIR, '[WEB]');
  audit.record(ctx, 'backup.run', { dir: r.dir ? path.basename(r.dir) : null });
  return { ok: Boolean(r.dir), files: r.files.length };
}

// T82: restore from a daily backup (owners). Applied at the next boot, then the bot restarts itself.
const restartHooks = { restart: () => setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1500) };

async function backupFiles(ctx, { date }) {
  requireOwner(ctx);
  const db = require('../util/dataBackup');
  return { date, files: db.restorableIn(DATA_DIR, date) };
}

async function restoreState(ctx) {
  requireOwner(ctx);
  const db = require('../util/dataBackup');
  return { pending: db.pendingRestore(DATA_DIR), last: db.lastRestore(DATA_DIR) };
}

async function restoreBackup(ctx, _p, body) {
  requireOwner(ctx);
  const db = require('../util/dataBackup');
  if (body?.action === 'cancel') {
    db.cancelRestore(DATA_DIR);
    audit.record(ctx, 'backup.restoreCancel', {});
    return { ok: true };
  }
  let files;
  try { files = db.requestRestore(DATA_DIR, String(body?.date || ''), body?.files, ctx.identity?.name || null); } catch (err) { throw new HttpError(400, err.message); }
  audit.record(ctx, 'backup.restore', { date: String(body.date), files });
  console.log(`[WEB] ${ctx.identity?.name || 'owner'} asked to restore ${files.length} item(s) from backup ${body.date} — restarting`);
  restartHooks.restart();
  return { ok: true, files };
}

function broadcastDraft(body) {
  const ids = (v) => (Array.isArray(v) ? v.map(String).filter(x => /^\d{17,20}$/.test(x)).slice(0, 500) : []);
  return {
    target: ['active', 'active_master', 'all', 'inactive', 'expired', 'owners'].includes(body?.target) ? body.target : 'active',
    guildId: /^\d{17,20}$/.test(String(body?.guildId || '')) ? String(body.guildId) : null,
    exclude: ids(body?.exclude),
    mode: body?.mode === 'all' ? 'all' : 'one',
    mentions: body?.mentions === true,
    message: String(body?.message || '').slice(0, 2000),
    messageEn: String(body?.messageEn || '').slice(0, 2000),
  };
}

// T54: preview (who gets it), send, retry failed, per-server language. Owner only.
async function broadcast(ctx, _p, body) {
  requireStaff(ctx);
  const bc = require('../panel/subsBroadcast');
  const action = body?.dryRun ? 'preview' : String(body?.action || 'send');
  if (action === 'lang') {
    if (!/^\d{17,20}$/.test(String(body?.guildId || ''))) throw new HttpError(400, 'bad guild');
    bc.setLang(String(body.guildId), body.lang === 'en' ? 'en' : 'ar');
    return { ok: true };
  }
  // T76: scheduled broadcasts + templates.
  const plan = require('../panel/broadcastPlan');
  const planErr = (err) => { throw new HttpError(400, err.message || 'bad request'); };
  if (action === 'unschedule') {
    if (!plan.unschedule(String(body?.id || ''))) throw new HttpError(404, 'not found');
    audit.record(ctx, 'broadcast.unschedule', { id: body.id });
    return { ok: true, scheduled: plan.listScheduled() };
  }
  if (action === 'tplsave') {
    try { return { ok: true, templates: plan.saveTemplate(body?.name, body?.message, body?.messageEn) }; } catch (err) { return planErr(err); }
  }
  if (action === 'tpldel') return { ok: true, templates: plan.deleteTemplate(String(body?.name || '')) };
  if (action === 'retry') {
    try {
      const r = await bc.retryBroadcast(masterClient(), String(body?.id || ''));
      audit.record(ctx, 'broadcast.retry', { id: r.id, ok: r.ok, fail: r.fail });
      return r;
    } catch (err) {
      if (err.code === 'BUSY') throw new HttpError(409, 'busy');
      if (err.code === 'NOT_FOUND') throw new HttpError(404, 'not found');
      throw err;
    }
  }
  const draft = broadcastDraft(body);
  if (action === 'preview') {
    const p = bc.plan(masterClient(), draft);
    return {
      kind: p.kind,
      messages: p.messages,
      servers: p.servers,
      busy: bc.isBusy(),
      items: p.items.map(i => ({
        guildId: i.guildId, guildName: i.guildName, lang: i.lang, excluded: i.excluded, skip: i.skip,
        ownerTag: i.ownerTag || null, guildCount: i.guildIds ? i.guildIds.length : 1,
        channels: (i.targets || []).map(x => ({ botKey: x.botKey, channelName: x.channelName || null })),
      })),
    };
  }
  if (!draft.message.trim()) throw new HttpError(400, 'empty message');
  if (action === 'schedule') {
    let item;
    try { item = plan.schedule(draft, body?.at, ctx.identity?.name || null); } catch (err) { return planErr(err); }
    audit.record(ctx, 'broadcast.schedule', { id: item.id, at: item.at, target: draft.guildId ? 'one' : draft.target });
    return { ok: true, scheduled: plan.listScheduled() };
  }
  let result;
  try {
    result = await bc.runBroadcast(masterClient(), draft, { by: ctx.identity?.name || null });
  } catch (err) {
    if (err.code === 'BUSY') throw new HttpError(409, 'busy');
    throw err;
  }
  audit.record(ctx, 'broadcast', { target: draft.guildId ? 'one' : draft.target, guildId: draft.guildId, mode: draft.mode, mentions: draft.mentions, ok: result.ok, fail: result.fail });
  return { id: result.id, ok: result.ok, fail: result.fail, total: result.total, skipped: result.skipped.length };
}

function broadcastHistory(ctx) {
  requireStaff(ctx);
  const bc = require('../panel/subsBroadcast');
  const plan = require('../panel/broadcastPlan');
  return { history: bc.history().slice(0, 30), langs: bc.langs(), busy: bc.isBusy(), scheduled: plan.listScheduled(), templates: plan.listTemplates() };
}

async function admins(ctx) {
  requireStaff(ctx);
  const owner = ctx.identity.role === 'owner';
  const client = masterClient();
  const userNames = {};
  const managers = owner ? managerStore.listUserIds() : [];
  const owners = isRootOwner(ctx.identity) ? ownerStore.listUserIds() : [];
  for (const uid of [...subsAdminStore.listUserIds().slice(0, 100), ...managers.slice(0, 50), ...owners]) {
    const u = client?.users?.cache?.get(uid) ?? await client?.users?.fetch(uid).catch(() => null);
    if (u) userNames[uid] = u.globalName || u.username || uid;
  }
  // Sessions (with IPs), the manager list and the admin-server picker are the owner's only.
  const managerScopes = owner ? Object.fromEntries(managers.map(u => [u, managerStore.scopeOf(u)])) : {};
  return { users: subsAdminStore.listUserIds(), roles: subsAdminStore.listRoleIds(), roleNames: subsAdminStore.listRoleNames(), sessions: owner ? auth.listSessions() : [], managers, managerScopes, owners, userNames, adminGuild: owner ? adminGuildView() : null };
}

// T65: the owner picks the admin server (where subscription admins and the subs panel live) in the dashboard.
function adminGuildView() {
  const { getAdminGuildId, adminGuildSource } = require('../subscription/adminConfig');
  const client = masterClient();
  const id = getAdminGuildId();
  const options = [...(client?.guilds?.cache?.values() || [])]
    .map(g => ({ id: String(g.id), name: g.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);
  return { id, name: id ? (client?.guilds?.cache?.get(id)?.name || null) : null, source: adminGuildSource(), options };
}

async function setAdminGuild(ctx, _p, body) {
  requireOwner(ctx);
  const raw = body?.guildId == null || body.guildId === '' ? null : String(body.guildId).trim();
  if (raw !== null) {
    if (!/^\d{17,20}$/.test(raw)) throw new HttpError(400, 'bad server id');
    if (!masterClient()?.guilds?.cache?.has(raw)) throw new HttpError(400, 'the bot is not in that server');
  }
  const before = require('../subscription/adminConfig').getAdminGuildId();
  subsAdminStore.setAdminGuildId(raw);
  audit.record(ctx, 'admin.guild', { from: before, to: raw });
  return admins(ctx);
}

// T57: owner adds/removes managers; removing one logs them out everywhere.
async function managerAction(ctx, _p, body) {
  requireOwner(ctx);
  const id = String(body?.userId || '').trim();
  if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, 'bad user id');
  if (ownerIds().has(id)) throw new HttpError(400, 'already owner');
  if (body.action === 'add') managerStore.addUser(id);
  else if (body.action === 'scope') {
    try { managerStore.setScope(id, Array.isArray(body.guildIds) ? body.guildIds : []); } catch (err) { throw new HttpError(400, err.message); }
    auth.destroyUserSessions(id, ctx.session.id); // new powers take effect at next login
  } else if (body.action === 'remove') {
    managerStore.removeUser(id);
    auth.destroyUserSessions(id, ctx.session.id);
  } else throw new HttpError(400, 'unknown action');
  audit.record(ctx, `manager.${body.action}`, { userId: id, guildIds: body.action === 'scope' ? body.guildIds : undefined });
  return admins(ctx);
}

// T82: .env owners add / remove dashboard owners (same powers, but cannot manage owners).
async function ownerAction(ctx, _p, body) {
  requireRootOwner(ctx);
  const id = String(body?.userId || '').trim();
  if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, 'bad user id');
  if (rootOwnerIds().has(id)) throw new HttpError(400, 'already owner');
  if (body.action === 'add') {
    const u = await masterClient()?.users?.fetch(id).catch(() => null);
    if (!u || u.bot) throw new HttpError(400, 'unknown user');
    ownerStore.addUser(id);
    if (managerStore.has(id)) managerStore.removeUser(id);
  } else if (body.action === 'remove') {
    ownerStore.removeUser(id);
  } else throw new HttpError(400, 'unknown action');
  auth.destroyUserSessions(id, ctx.session.id); // new role at next login
  audit.record(ctx, `owner.${body.action}`, { userId: id });
  return admins(ctx);
}

async function adminAction(ctx, _p, body) {
  requireStaff(ctx);
  const id = String(body?.userId || '').trim();
  if (!/^\d{17,20}$/.test(id)) throw new HttpError(400, 'bad user id');
  if (body.action === 'add') subsAdminStore.addUser(id);
  else if (body.action === 'remove') {
    if (id === ctx.identity.userId) throw new HttpError(400, 'you cannot remove yourself');
    if (subsAdminStore.listUserIds().length <= 1) throw new HttpError(400, 'cannot remove the last admin');
    subsAdminStore.removeUser(id);
  } else throw new HttpError(400, 'unknown action');
  audit.record(ctx, `admin.${body.action}`, { userId: id });
  return admins(ctx);
}

// T82: the password login is the .env owners' (dashboard owners cannot change it or log them out).
function requireRootOwner(ctx) {
  if (!isRootOwner(ctx.identity)) throw new HttpError(403, 'root owner only');
}

function isRootSession(sid, userId) {
  const s = auth.listSessions().find(x => (sid ? x.id === sid : String(x.userId) === String(userId)));
  if (!s && userId) return rootOwnerIds().has(String(userId));
  return Boolean(s && s.role === 'owner' && (!s.userId || rootOwnerIds().has(String(s.userId))));
}

async function changePassword(ctx, _p, body) {
  requireRootOwner(ctx);
  const pw = String(body?.password || '');
  if (!auth.passwordStrongEnough(pw)) throw new HttpError(400, 'password: 10+ chars, letters and digits');
  auth.setPassword(pw);
  const n = auth.destroyAllSessions(ctx.session.id);
  audit.record(ctx, 'auth.password', { revokedSessions: n });
  return { ok: true, revokedSessions: n };
}

async function revokeSessions(ctx, _p, body) {
  requireOwner(ctx);
  const root = isRootOwner(ctx.identity);
  if (body?.id) {
    if (body.id === ctx.session.id) throw new HttpError(400, 'use logout');
    if (!root && isRootSession(String(body.id), null)) throw new HttpError(403, 'root owner only');
    const ok = auth.destroySessionById(String(body.id));
    audit.record(ctx, 'auth.revoke', { id: String(body.id) });
    return { ok, revoked: ok ? 1 : 0 };
  }
  if (body?.userId) {
    if (!root && isRootSession(null, body.userId)) throw new HttpError(403, 'root owner only');
    const n = auth.destroyUserSessions(String(body.userId), ctx.session.id);
    audit.record(ctx, 'auth.revoke', { userId: String(body.userId), revoked: n });
    return { ok: true, revoked: n };
  }
  requireRootOwner(ctx);
  const n = auth.destroyAllSessions(ctx.session.id);
  audit.record(ctx, 'auth.revokeAll', { revoked: n });
  return { ok: true, revoked: n };
}

async function auditLog(ctx) {
  requireStaff(ctx); // T81: managers read it without IP addresses
  const list = audit.list(300);
  return ctx.identity.role === 'owner' ? list : list.map(({ ip, ...e }) => e);
}

// T81: what server admins see on this server (owner and full managers edit it; default or this server).
async function getAdminView(ctx, { id }) {
  requireStaff(ctx);
  requireGuild(ctx, id);
  return { sections: adminView.SECTIONS, levels: adminView.LEVELS, ...adminView.raw(id), effective: adminView.effective(id) };
}

async function setAdminView(ctx, { id }, body) {
  requireStaff(ctx);
  requireGuild(ctx, id);
  const patch = body?.levels && typeof body.levels === 'object' ? body.levels : {};
  if (body?.scope === 'default') adminView.setDefault(patch);
  else adminView.setGuild(id, patch);
  audit.record(ctx, 'adminview.set', { guildId: body?.scope === 'default' ? null : String(id), scope: body?.scope === 'default' ? 'default' : 'guild', levels: patch });
  return getAdminView(ctx, { id });
}

// ---- T82: support tickets. Everyone signed in opens tickets about the bot; owners and managers answer.
// New tickets / replies go to the subscriptions log channel of the admin server (else a DM to the .env owners);
// a staff reply is sent to the person by DM with a link back.
const support = require('./supportStore');

async function staffNotify(text) {
  const client = masterClient();
  const opts = { content: text.slice(0, 1900), allowedMentions: { parse: [] } };
  try {
    const { getAdminGuildId, getSubsAuditChannelId } = require('../subscription/adminConfig');
    const ch = client?.guilds?.cache?.get(getAdminGuildId() || '')?.channels?.cache?.get(getSubsAuditChannelId() || '');
    if (ch?.isTextBased?.() && await ch.send(opts).then(() => true).catch(() => false)) return true;
  } catch { /* fall back to DM */ }
  let sent = false;
  for (const uid of rootOwnerIds()) {
    const u = await client?.users?.fetch(uid).catch(() => null);
    if (u && await u.send(opts).then(() => true).catch(() => false)) sent = true;
  }
  return sent;
}

function ticketLink(id) {
  const base = String(process.env.WEB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return /^https:\/\//.test(base) ? `${base}/#/support/${id}` : '';
}

function supportViewer(ctx) {
  return { userId: ctx.identity?.userId || null, staff: isStaff(ctx.identity) };
}

function ticketGuilds(ctx) {
  const client = masterClient();
  const ids = [...new Set([...(ctx.identity?.guilds || []), ...(ctx.identity?.memberGuilds || [])])].slice(0, 50);
  return ids.map(id => ({ id, name: client?.guilds?.cache?.get(id)?.name || id }));
}

async function supportList(ctx, _p, _b, query) {
  const v = supportViewer(ctx);
  const status = support.STATUSES.includes(query.get('status')) ? query.get('status') : null;
  const tickets = support.list({ ...v, status }).slice(0, 300).map(x => ({ ...x, guildName: x.guildId ? (masterClient()?.guilds?.cache?.get(x.guildId)?.name || null) : null }));
  return { staff: v.staff, kinds: support.KINDS, tickets, guilds: ticketGuilds(ctx), unread: support.unreadCount(v) };
}

async function supportGet(ctx, { id }) {
  const v = supportViewer(ctx);
  const x = support.get(id);
  if (!support.canSee(x, v)) throw new HttpError(404, 'not found');
  support.markRead(x.id, v);
  return { staff: v.staff, ticket: { ...x, guildName: x.guildId ? (masterClient()?.guilds?.cache?.get(x.guildId)?.name || null) : null } };
}

async function supportNew(ctx, _p, body) {
  if (!ctx.identity?.userId && !isStaff(ctx.identity)) throw new HttpError(403, 'sign in with Discord');
  if (auth.rateLimited(`ticket:${ctx.identity.userId || ctx.ip}`, 3, 10 * 60_000)) throw new HttpError(429, 'slow down');
  const guildId = String(body?.guildId || '');
  if (guildId && !isStaff(ctx.identity) && !ticketGuilds(ctx).some(g => g.id === guildId)) throw new HttpError(400, 'bad server');
  let x;
  try {
    x = support.create({ userId: ctx.identity.userId, userName: ctx.identity.name, kind: body?.kind, guildId, title: body?.title, text: body?.text });
  } catch (err) { throw new HttpError(400, err.message); }
  audit.record(ctx, 'support.new', { id: x.id, kind: x.kind, guildId: x.guildId });
  const gname = x.guildId ? (masterClient()?.guilds?.cache?.get(x.guildId)?.name || x.guildId) : null;
  const link = ticketLink(x.id);
  const quote = x.messages[0].text.slice(0, 600).replace(/\n/g, '\n> ');
  void staffNotify(`🎫 **#${x.id}** ${x.kind} — **${x.title}**\nfrom ${ctx.identity.name}${ctx.identity.userId ? ` (<@${ctx.identity.userId}>)` : ''}${gname ? ` · ${gname}` : ''}\n> ${quote}${link ? `\n${link}` : ''}`).catch(() => {});
  return { ok: true, id: x.id };
}

async function supportAction(ctx, { id }, body) {
  const v = supportViewer(ctx);
  const x = support.get(id);
  if (!support.canSee(x, v)) throw new HttpError(404, 'not found');
  const action = String(body?.action || '');
  if (action === 'reply') {
    if (!v.staff && x.status === 'closed') throw new HttpError(400, 'ticket closed');
    if (auth.rateLimited(`treply:${ctx.identity.userId || ctx.ip}`, 10, 60_000)) throw new HttpError(429, 'slow down');
    try { support.reply(x.id, { staff: v.staff, name: ctx.identity.name, text: body?.text }); } catch (err) { throw new HttpError(400, err.message); }
    support.markRead(x.id, v);
    const text = String(body.text).trim().slice(0, 1200);
    const link = ticketLink(x.id);
    if (v.staff && x.userId && x.userId !== String(ctx.identity.userId || '')) {
      const u = await masterClient()?.users?.fetch(x.userId).catch(() => null);
      const quote = text.replace(/\n/g, '\n> ');
      await u?.send({ content: `📩 رد على تذكرتك **#${x.id}** — ${x.title}\n> ${quote}${link ? `\n${link}` : ''}`.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
    } else if (!v.staff) {
      void staffNotify(`💬 **#${x.id}** — ${x.title}\n${ctx.identity.name}: ${text.slice(0, 600)}${link ? `\n${link}` : ''}`).catch(() => {});
    }
  } else if (action === 'close' || action === 'reopen') {
    if (action === 'reopen' && !v.staff && support.list({ userId: v.userId }).filter(t => t.status !== 'closed').length >= 5) throw new HttpError(400, 'too many open tickets');
    support.setStatus(x.id, action === 'close' ? 'closed' : 'open');
  } else throw new HttpError(400, 'unknown action');
  audit.record(ctx, `support.${action}`, { id: x.id });
  return supportGet(ctx, { id: x.id });
}

function markBoot(kind) {
  if (kind === 'master' && !boot.masterReadyAt) boot.masterReadyAt = Math.round(process.uptime() * 10) / 10;
  if (kind === 'slaves') boot.slavesReadyAt = Math.round(process.uptime() * 10) / 10;
}

const routes = [
  ['GET', '/api/me', me],
  ['GET', '/api/overview', overview],
  ['GET', '/api/metrics', metricsHistory],
  ['GET', '/api/guilds', guilds],
  ['GET', '/api/guilds/:id', guildDetail],
  ['POST', '/api/guilds/:id/subscription', subscriptionAction],
  ['POST', '/api/guilds/:id/leave', leaveGuild],
  ['POST', '/api/guilds/:id/voice', voiceAction],
  ['POST', '/api/guilds/:id/rooms', setRooms],
  ['POST', '/api/guilds/:id/bridge', bridgeAction],
  ['POST', '/api/guilds/:id/roombot', roomBotAction],
  ['POST', '/api/guilds/:id/renew', renewRequest],
  ['GET', '/api/guilds/:id/guests', guestLinks],
  ['POST', '/api/guilds/:id/guests', guestAction],
  ['GET', '/api/guilds/:id/perms', getPerms],
  ['POST', '/api/guilds/:id/perms', setPerms],
  ['GET', '/api/guilds/:id/perms/test', testPerms],
  ['GET', '/api/guilds/:id/members', guildMembers],
  ['GET', '/api/guilds/:id/adminview', getAdminView],
  ['POST', '/api/guilds/:id/adminview', setAdminView],
  ['GET', '/api/queues/:key/playlists', queuePlaylists],
  ['GET', '/api/queues/:key', queueDetail],
  ['POST', '/api/queues/:key', queueAction],
  ['GET', '/api/search', search],
  ['GET', '/api/rooms', rooms],
  ['GET', '/api/now', now],
  ['GET', '/api/bots', bots],
  ['GET', '/api/logs', logs],
  ['GET', '/api/backups', backups],
  ['POST', '/api/backups', runBackupNow],
  ['GET', '/api/restore', restoreState],
  ['POST', '/api/restore', restoreBackup],
  ['GET', '/api/backups/:date', backupFiles],
  ['POST', '/api/broadcast', broadcast],
  ['GET', '/api/broadcasts', broadcastHistory],
  ['GET', '/api/admins', admins],
  ['POST', '/api/admins', adminAction],
  ['POST', '/api/managers', managerAction],
  ['POST', '/api/owners', ownerAction],
  ['POST', '/api/admin-guild', setAdminGuild],
  ['POST', '/api/password', changePassword],
  ['POST', '/api/sessions/revoke', revokeSessions],
  ['GET', '/api/audit', auditLog],
  ['GET', '/api/support', supportList],
  ['POST', '/api/support', supportNew],
  ['GET', '/api/support/:id', supportGet],
  ['POST', '/api/support/:id', supportAction],
].map(([method, pattern, fn]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:[a-z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })}$`);
  return { method, re, keys, fn };
});

function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { fn: r.fn, params };
  }
  return null;
}

module.exports = {
  match,
  HttpError,
  activeStreams,
  voiceConnections,
  voiceDownGuilds,
  listQueues,
  queueView,
  guildIdForQueueKey,
  markBoot,
  masterClient,
  avatarUrl,
  maskIps,
  restartHooks,
};
