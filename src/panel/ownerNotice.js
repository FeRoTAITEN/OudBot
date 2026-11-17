// ownerNotice.js – T59: when the bot cannot manage room access in a server (role order or missing
// Manage Roles / Manage Channels), tell the server owner once, with the exact steps.
// DM first; if DMs are closed, the Oud room chat. At most once per server per NOTICE_EVERY_MS
// (saved to disk so restarts do not repeat it).
'use strict';
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'owner-notices.json');
const NOTICE_EVERY_MS = 7 * 24 * 3600_000;
const inflight = new Set();

function load() {
  const res = readJson(FILE);
  return res.ok && res.data && typeof res.data === 'object' ? res.data : {};
}

/** What is wrong in this guild, as i18n keys. Empty = nothing to fix. */
function diagnose(guild, channel = null) {
  const me = guild?.members?.me;
  if (!me) return [];
  const { OUD_ROLE_NAME } = require('./roomAccess');
  const issues = [];
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) issues.push('notice.issueManageRoles');
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) issues.push('notice.issueManageChannels');
  const entry = guild.roles.cache.find(r => r.name === OUD_ROLE_NAME());
  if (entry && me.roles.highest.comparePositionTo(entry) <= 0) issues.push('notice.issueRoleOrder');
  if (!issues.length && channel?.permissionsFor) {
    const p = channel.permissionsFor(me);
    if (p && (!p.has(PermissionFlagsBits.ManageRoles) || !p.has(PermissionFlagsBits.ManageChannels))) {
      issues.push('notice.issueChannelPerms');
    } else if (p) {
      // The bot can only allow the entry role what it has itself in this room.
      const ENTRY = ['ViewChannel', 'Connect', 'Speak', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks'];
      if (ENTRY.some(k => !p.has(PermissionFlagsBits[k]))) issues.push('notice.issueChannelEntry');
      // Existing allows on the entry role that the bot lacks block every edit of that role in this room.
      else if (entry && [...(channel.permissionOverwrites?.cache?.get(entry.id)?.allow?.toArray?.() || []), ...(channel.permissionOverwrites?.cache?.get(entry.id)?.deny?.toArray?.() || [])].some(k => !p.has(PermissionFlagsBits[k]))) {
        issues.push('notice.issueChannelExtra');
      }
    }
  }
  return issues;
}

function langFor(guild) {
  return String(guild?.preferredLocale || '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function buildText(guild, issues, channel = null) {
  const { createTranslator } = require('../i18n');
  const t = createTranslator(langFor(guild));
  const { OUD_ROLE_NAME } = require('./roomAccess');
  const vars = {
    server: guild.name,
    channel: channel ? `#${channel.name}` : '',
    botRole: guild.members.me?.roles?.highest?.name || 'Oud',
    entryRole: OUD_ROLE_NAME(),
  };
  const lines = issues.map(k => `• ${t(k, vars)}`).join('\n');
  return t('notice.roomAccessBody', { ...vars, issues: lines });
}

async function sendToOwner(guild, text) {
  const owner = await guild.fetchOwner().catch(() => null);
  if (owner) {
    const ok = await owner.send(text).then(() => true).catch(() => false);
    if (ok) return 'dm';
  }
  const { getMasterChannels } = require('../config/channels');
  const id = getMasterChannels(guild.id).textChannelId;
  const ch = id ? guild.channels.cache.get(id) : null;
  if (ch?.isTextBased?.()) {
    const ok = await ch.send(text).then(() => true).catch(() => false);
    if (ok) return 'room';
  }
  return null;
}

/**
 * Tell the owner of this guild what to fix, if anything is wrong and we did not tell them recently.
 * @returns {Promise<'dm'|'room'|null>}
 */
async function notifyRoomAccessProblem(guild, tag = '[ROOM]', { now = Date.now(), channel = null } = {}) {
  if (!guild?.id || inflight.has(guild.id)) return null;
  const issues = diagnose(guild, channel);
  if (!issues.length) return null;
  const all = load();
  const last = all[guild.id]?.at || 0;
  if (now - last < NOTICE_EVERY_MS) return null;
  inflight.add(guild.id);
  try {
    const via = await sendToOwner(guild, buildText(guild, issues, channel));
    all[guild.id] = { at: now, via, issues };
    writeJsonAtomic(FILE, all, { backup: false });
    console.warn(`${tag} Told the owner of ${guild.name} how to fix room access (${via || 'not delivered'}): ${issues.join(', ')}`);
    return via;
  } finally {
    inflight.delete(guild.id);
  }
}

const RECHECK_DELAY_MS = 15_000;
const recheckTimers = new Map();

/** After the owner fixes roles, re-run the room access setup and say thanks. */
async function recheckGuild(guild, tag) {
  const all = load();
  const entry = all[guild.id];
  if (!entry || entry.resolvedAt) return false;
  if (diagnose(guild).length) return false;
  const { ensureMasterVoiceRoom } = require('./masterRoomBootstrap');
  await ensureMasterVoiceRoom(guild, { syncAccess: true, tag }).catch(() => {});
  entry.resolvedAt = Date.now();
  writeJsonAtomic(FILE, all, { backup: false });
  console.log(`${tag} Room access fixed by the owner in ${guild.name} — permissions re-applied`);
  if (entry.via === 'dm') {
    const { createTranslator } = require('../i18n');
    const t = createTranslator(langFor(guild));
    const owner = await guild.fetchOwner().catch(() => null);
    await owner?.send(t('notice.roomAccessFixed', { server: guild.name })).catch(() => {});
  }
  return true;
}

function scheduleRecheck(guild, tag) {
  if (!guild?.id || !load()[guild.id] || load()[guild.id].resolvedAt) return;
  clearTimeout(recheckTimers.get(guild.id));
  const timer = setTimeout(() => {
    recheckTimers.delete(guild.id);
    recheckGuild(guild, tag).catch(() => {});
  }, RECHECK_DELAY_MS);
  timer.unref?.();
  recheckTimers.set(guild.id, timer);
}

/** Main bot: watch role changes in servers we told about a problem. */
function attachOwnerNoticeWatch(client, tag = '[ROOM]') {
  if (client._ownerNoticeWatch) return;
  client._ownerNoticeWatch = true;
  client.on('roleUpdate', (oldRole, newRole) => scheduleRecheck(newRole.guild, tag));
  client.on('guildMemberUpdate', (oldMember, newMember) => {
    if (newMember.id === client.user?.id) scheduleRecheck(newMember.guild, tag);
  });
}

module.exports = {
  notifyRoomAccessProblem, diagnose, buildText, recheckGuild, attachOwnerNoticeWatch,
  _setFile: (f) => { FILE = f; },
};
