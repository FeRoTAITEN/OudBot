const subsAdminStore = require('./subsAdminStore');

const SNOWFLAKE = /^\d{17,20}$/;
const SELECT_LIMIT = 25;

function guildMembersIntentEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.GUILD_MEMBERS_INTENT?.trim() || '');
}

function normalizeQuery(raw) {
  return String(raw ?? '').trim().replace(/^@/, '');
}

function memberLabel(member) {
  const u = member.user;
  const username = u?.username || member.id;
  const nick = member.displayName;
  if (nick && nick.toLowerCase() !== username.toLowerCase()) {
    return `${username} (${nick})`;
  }
  return username;
}

function autocompleteChoiceLabel(member) {
  const u = member.user.username || member.id;
  const nick = member.displayName;
  if (nick && nick.toLowerCase() !== u.toLowerCase()) {
    return `${u} · ${nick}`.slice(0, 100);
  }
  return u.slice(0, 100);
}

function matchesQuery(member, queryLower) {
  const u = member.user;
  if (u.username?.toLowerCase() === queryLower) return true;
  if (u.globalName?.toLowerCase() === queryLower) return true;
  if (member.displayName?.toLowerCase() === queryLower) return true;
  return false;
}

function isEligiblePermMember(member, existingIds) {
  return member?.user && !member.user.bot && !existingIds.has(member.id);
}

async function loadPermMemberCandidates(guild, query = '') {
  if (!guild || !guildMembersIntentEnabled()) return [];

  const q = normalizeQuery(query);
  if (q && SNOWFLAKE.test(q)) {
    const one = await guild.members.fetch(q).catch(() => null);
    return one ? [one] : [];
  }

  if (q.length >= 1) {
    const fetched = await guild.members.fetch({ query: q, limit: SELECT_LIMIT }).catch(() => null);
    return fetched ? [...fetched.values()] : [];
  }

  await guild.members.fetch().catch(() => null);
  return [...guild.members.cache.values()];
}

async function searchPermMembers(guild, query = '') {
  const existing = new Set(subsAdminStore.listUserIds());
  const members = await loadPermMemberCandidates(guild, query);
  return members
    .filter(m => isEligiblePermMember(m, existing))
    .sort((a, b) => a.user.username.localeCompare(b.user.username));
}

async function buildPermAddUserOptions(guild) {
  const members = await searchPermMembers(guild, '');
  const truncated = members.length > SELECT_LIMIT;
  const options = members.slice(0, SELECT_LIMIT).map(m => ({
    label: (m.user.username || m.id).slice(0, 100),
    description: (
      m.displayName && m.displayName !== m.user.username
        ? m.displayName
        : m.user.globalName || '—'
    ).slice(0, 100),
    value: m.id,
  }));
  return { options, truncated, total: members.length };
}

async function resolveAdminPermUser(guild, raw) {
  const q = normalizeQuery(raw);
  if (!q || !guild) return { ok: false, reason: 'empty' };

  if (SNOWFLAKE.test(q)) {
    const member = await guild.members.fetch(q).catch(() => null);
    if (member) {
      return { ok: true, userId: member.id, label: memberLabel(member) };
    }
    const user = await guild.client.users.fetch(q).catch(() => null);
    if (!user) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      userId: user.id,
      label: user.username,
      notInGuild: true,
    };
  }

  if (!guildMembersIntentEnabled()) {
    return { ok: false, reason: 'need_intent' };
  }

  const queryLower = q.toLowerCase();
  const members = await searchPermMembers(guild, q);
  if (!members.length) return { ok: false, reason: 'not_found' };

  const exact = members.filter(m => matchesQuery(m, queryLower));
  if (exact.length === 1) {
    return { ok: true, userId: exact[0].id, label: memberLabel(exact[0]) };
  }
  if (exact.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      matches: exact.slice(0, 5).map(memberLabel),
    };
  }

  const usernameHits = members.filter(
    m => m.user.username?.toLowerCase().includes(queryLower),
  );
  if (usernameHits.length === 1) {
    return { ok: true, userId: usernameHits[0].id, label: memberLabel(usernameHits[0]) };
  }

  if (members.length === 1) {
    return { ok: true, userId: members[0].id, label: memberLabel(members[0]) };
  }

  return {
    ok: false,
    reason: 'ambiguous',
    matches: members.slice(0, 5).map(memberLabel),
  };
}

async function formatPermUserLine(client, guild, userId) {
  const id = String(userId);
  let user = client.users.cache.get(id);
  if (!user) user = await client.users.fetch(id).catch(() => null);

  let member = guild?.members.cache.get(id);
  if (!member && guild) member = await guild.members.fetch(id).catch(() => null);

  const username = user?.username ?? id;
  const nick = member?.displayName;
  const nickPart = nick && nick.toLowerCase() !== username.toLowerCase()
    ? ` · _${nick}_`
    : '';
  return `• <@${id}> — \`${username}\`${nickPart}`;
}

module.exports = {
  guildMembersIntentEnabled,
  resolveAdminPermUser,
  formatPermUserLine,
  searchPermMembers,
  buildPermAddUserOptions,
  autocompleteChoiceLabel,
  SELECT_LIMIT,
};
