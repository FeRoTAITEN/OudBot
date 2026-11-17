// memberAccess.js – T24: what a plain Discord member (OAuth login, no Manage Server) may do in the dashboard.
// Levels mirror the Discord side: listener = in the bot's voice room, roomOwner = queue.roomOwnerId,
// dj = has a role named "DJ", admin = Manage Server / Administrator (full guild access, handled by identity.js).
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const { canAccessGuild } = require('./identity');
const guildPerms = require('./guildPerms');

// Listeners (in the bot's room): add songs, vote skip, pause/resume, volume (owner decision 2026-10-25).
const LISTENER = ['play', 'skip', 'pause', 'resume', 'volume'];
const CONTROL = [
  ...LISTENER, 'pause', 'resume', 'shuffle', 'loop', 'volume', 'seek', 'filter',
  'remove', 'move', 'moveto', 'jump', 'clear', 'autodj', 'autodjmode',
];
const ACTIONS = {
  banned: [],
  viewer: [],
  listener: LISTENER,
  roomOwner: CONTROL,
  dj: [...CONTROL, 'stop'],
};

// Paths a member session may call (everything else is 403 in server.js).
const MEMBER_PATHS = [
  ['GET', /^\/api\/me$/],
  ['GET', /^\/api\/stream$/],
  ['GET', /^\/api\/rooms$/],
  ['GET', /^\/api\/now$/],
  ['GET', /^\/api\/search$/],
  ['GET', /^\/api\/queues\/[^/]+$/],
  ['POST', /^\/api\/queues\/[^/]+$/],
  ['GET', /^\/api\/support$/], // T82: support tickets
  ['POST', /^\/api\/support$/],
  ['GET', /^\/api\/support\/\d+$/],
  ['POST', /^\/api\/support\/\d+$/],
];

function allowedPath(method, pathname) {
  return MEMBER_PATHS.some(([m, re]) => m === method && re.test(pathname));
}

/** Subscribed guilds (bot inside) where this user is a member. Used at login. */
async function memberGuildsOf(client, userId) {
  const id = String(userId || '');
  if (!client || !/^\d{17,20}$/.test(id)) return [];
  const out = [];
  for (const gid of subscriptionStore.listGuildIds()) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    if (member) out.push(String(gid));
  }
  return out;
}

/** Guild visible to this identity: full access (owner/admin) or member view. */
function canViewGuild(identity, guildId) {
  if (canAccessGuild(identity, guildId)) return true;
  return Boolean(identity?.memberGuilds?.includes(String(guildId)) && subscriptionStore.isGuildAllowed(guildId));
}

async function memberOf(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.cache.get(String(userId)) ?? await guild.members.fetch(String(userId)).catch(() => null);
}

/** Level of a member in one room (queue). Live: voice state and roles are read now, not at login. */
async function levelFor(identity, guild, queue) {
  return levelForMember(await memberOf(guild, identity?.userId), guild, queue);
}

/** Same as levelFor, for a guild member object already at hand (Discord buttons / commands). */
function levelForMember(member, guild, queue) {
  if (!member || !guild) return 'viewer';
  // T81: a server admin whose music section is read/hide controls songs like any member (DJ, listener...).
  try {
    if (registry.canUsePanel(member)
      && require('./identity').memberSectionLevel(member, guild.id, 'music') === 'show') return 'admin';
  } catch { /* ignore */ }
  const p = guildPerms.get(guild.id);
  if (p.bannedUserIds.includes(member.id)) return 'banned';
  if (p.djUserIds.includes(member.id)) return 'dj';
  const djRole = p.djRoleIds.length
    ? (r) => p.djRoleIds.includes(String(r.id))
    : (r) => /^dj$/i.test(r.name);
  if (member.roles?.cache?.some?.(djRole)) return 'dj';
  if (queue?.roomOwnerId && queue.roomOwnerId === member.id) return 'roomOwner';
  if (queue?.voiceChannelId && member.voice?.channelId === queue.voiceChannelId) return 'listener';
  return 'viewer';
}

// Discord music button / command action -> dashboard action it needs. Not listed = view only (menus, queue pages, lyrics...).
const DISCORD_ACTIONS = {
  pause: 'pause', resume: 'resume', seekback: 'seek', seekfwd: 'seek', restart: 'seek',
  skip: 'skip', shuffle: 'shuffle', loop: 'loop', volume: 'volume', vol: 'volume', filter: 'filter',
  pick: 'play', loadpl: 'play', loadhist: 'play', replaylast: 'play', urlpick: 'play', playsearch: 'play', play: 'play',
  rmtrack: 'remove', rmqueue: 'remove', clearask: 'clear', clearyes: 'clear', playqueue: 'jump',
  movepick: 'move', moveup: 'move', movedown: 'move',
  startautodj: 'autodj', autodj: 'autodj', autodjtoggle: 'autodj', autodjmood: 'autodj',
  editpl: 'clear', editpage: 'clear', delpl: 'clear', del_yes: 'clear', clearhistask: 'clear', clearhistyes: 'clear',
  stop: 'stop', stopyes: 'stop',
  // T62 text commands
  remove: 'remove', clear: 'clear', seek: 'seek', back: 'seek',
};

/**
 * Gate for Discord music controls, same levels as the dashboard.
 * Returns { ok, level, reason } — reason is an i18n key when denied.
 */
function discordGate(member, guild, queue, discordAction) {
  const level = levelForMember(member, guild, queue);
  if (level === 'banned') return { ok: false, level, reason: 'perm.deniedBanned' };
  const need = DISCORD_ACTIONS[discordAction];
  if (!need || level === 'admin') return { ok: true, level };
  // Nothing playing (or bot not in a room yet): anyone in a voice channel may start music, like before.
  const perms = guildPerms.get(guild.id);
  const idle = !queue?.voiceChannelId || (!queue?.current && !queue?.tracks?.length);
  if (!perms.djOnly && idle && need === 'play' && member?.voice?.channelId) return { ok: true, level: level === 'viewer' ? 'listener' : level };
  if (can(level, need, perms)) return { ok: true, level };
  if (perms.djOnly && level !== 'dj') return { ok: false, level, reason: 'perm.deniedDjOnly' };
  return { ok: false, level, reason: level === 'viewer' ? 'perm.deniedNotInRoom' : 'perm.deniedLevel' };
}

/** Allowed actions; listener actions follow the server's T25 settings (perms = guildPerms.get(gid)). */
function actionsFor(level, perms = guildPerms.DEFAULTS) {
  if (level === 'admin') return ['*'];
  let list = ACTIONS[level] || [];
  // T69: "DJ only" — listeners and room owners keep view only.
  if (perms.djOnly && (level === 'listener' || level === 'roomOwner')) return [];
  if (level === 'listener') {
    list = list.filter(a => (a !== 'play' || perms.listenerCanAdd) && (a !== 'skip' || perms.listenerVoteSkip)
      && ((a !== 'pause' && a !== 'resume') || perms.listenerCanPause !== false)
      && (a !== 'volume' || perms.listenerCanVolume !== false));
  }
  return list;
}

function can(level, action, perms) {
  return level === 'admin' || actionsFor(level, perms).includes(action);
}

/** T69: highest music volume this level may set on this server. */
function volumeCap(level, perms = guildPerms.DEFAULTS) {
  return level === 'admin' || level === 'dj' ? 200 : (perms.listenerMaxVolume ?? 200);
}

module.exports = { allowedPath, memberGuildsOf, canViewGuild, memberOf, levelFor, levelForMember, discordGate, actionsFor, can, volumeCap, ACTIONS, DISCORD_ACTIONS };
