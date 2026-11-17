// playLimits.js – T58b: the server limits from the permissions panel ("allow links", "songs per minute",
// "max song length") apply to Discord plays too, not only the dashboard. Server admins are exempt (same as web).
'use strict';

const RATE_WINDOW_MS = 60_000;

function permsFor(guildId) {
  if (!guildId) return null;
  try { return require('../web/guildPerms').get(guildId); } catch { return null; }
}

/** True when this user is a server admin (or bot controller) in this guild. */
function isExempt(guild, userId) {
  if (!guild || !userId) return false;
  try {
    const identity = require('../web/identity');
    if (identity.ownerIds().has(String(userId)) || identity.isManagerId(userId)) return true;
  } catch { /* ignore */ }
  const member = guild.members?.cache?.get(String(userId));
  if (!member) return false;
  try { return require('../web/memberAccess').levelForMember(member, guild, null) === 'admin'; } catch { return false; }
}

/**
 * Check one typed play request (text command or search modal).
 * Returns null when allowed, or { key, vars } for the i18n reply.
 */
function checkPlayRequest(guild, userId, query) {
  const perms = permsFor(guild?.id);
  if (!perms || isExempt(guild, userId)) return null;
  if (!perms.allowLinks && /^https?:\/\//i.test(String(query || '').trim())) return { key: 'perm.linksOff', vars: {} };
  // Same bucket as the dashboard (web/api.js queueAction), so both sides share one per-minute budget.
  const { rateLimited } = require('../web/auth');
  if (rateLimited(`mplay:${guild.id}:${userId}`, perms.playPerMin, RATE_WINDOW_MS)) {
    return { key: 'perm.tooManyPlays', vars: { n: perms.playPerMin } };
  }
  return null;
}

/** Max track length in seconds for tracks this requester adds, or 0 for no limit. */
function maxTrackSecFor(guild, requesterId) {
  const perms = permsFor(guild?.id);
  if (!perms?.maxTrackMin) return 0;
  if (requesterId && requesterId !== 'autodj' && isExempt(guild, requesterId)) return 0;
  return perms.maxTrackMin * 60;
}

/** T69: how many songs this member may still add (Infinity = no limit). DJs and admins have no limit. */
function queueRoomFor(guild, queue, requesterId) {
  const perms = permsFor(guild?.id);
  if (!perms?.maxQueuedPerMember || !requesterId || requesterId === 'autodj') return Infinity;
  if (isExempt(guild, requesterId)) return Infinity;
  const member = guild.members?.cache?.get(String(requesterId));
  try {
    if (member && require('../web/memberAccess').levelForMember(member, guild, null) === 'dj') return Infinity;
  } catch { /* ignore */ }
  const mine = (queue?.tracks || []).filter(tr => String(tr.requester?.id) === String(requesterId)).length;
  return Math.max(0, perms.maxQueuedPerMember - mine);
}

module.exports = { checkPlayRequest, maxTrackSecFor, isExempt, queueRoomFor };
