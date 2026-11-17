const { PermissionFlagsBits, OverwriteType, PermissionsBitField } = require('discord.js');
const { isOudManagedRoom } = require('./oudRoomRegistry');
const { logOnce } = require('../util/logger');

const OUD_ROLE_NAME = () => process.env.BRIDGE_OUD_ROLE_NAME?.trim() || 'oud';

const ENTRY_ROLE_PERM_BITS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
];

/** Guild-level perms on @Oud Entry (not channel overwrites). */
const ENTRY_GUILD_PERM_BITS = [
  PermissionFlagsBits.ChangeNickname,
];

/** Discord.js edit/create expects { ViewChannel: true } — not { allow: bitfield }. */
function entryRoleAllowOptions() {
  return {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    SendMessages: true,
    ReadMessageHistory: true,
    EmbedLinks: true,
  };
}

/** Raw allow/deny for channel.create permissionOverwrites only. */
function entryRoleAllowBitfield() {
  return {
    allow: PermissionsBitField.resolve(ENTRY_ROLE_PERM_BITS),
    deny: PermissionsBitField.resolve([]),
  };
}

function roleAllowOverwrite(id) {
  return { id, type: OverwriteType.Role, ...entryRoleAllowBitfield() };
}

function everyoneDenyViewOverwrite(guildId) {
  return {
    id: guildId,
    type: OverwriteType.Role,
    allow: PermissionsBitField.resolve([]),
    deny: PermissionsBitField.resolve([PermissionFlagsBits.ViewChannel]),
  };
}

/** @everyone must have an explicit deny on View Channel (red X in Discord UI). */
function isEveryoneViewDenied(guild, channel) {
  if (!guild || !channel) return false;
  const ow = channel.permissionOverwrites?.cache?.get(guild.id);
  if (ow?.deny?.has(PermissionFlagsBits.ViewChannel)) return true;
  const perms = channel.permissionsFor(guild.roles.everyone);
  return perms ? !perms.has(PermissionFlagsBits.ViewChannel) : false;
}

async function denyEveryoneViewChannel(guild, channel, tag = '[ROOM]', reason = 'Bridge: hide room from @everyone') {
  if (!botCanManageChannel(guild, channel)) {
    console.warn(
      `${tag} Cannot hide #${channel.name} from @everyone — grant Manage Channels on this channel/category`,
    );
    return false;
  }
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
    }, { reason });
    await channel.fetch(true).catch(() => {});
    if (!isEveryoneViewDenied(guild, channel)) {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        allow: [],
        deny: [PermissionFlagsBits.ViewChannel],
      }, { reason });
      await channel.fetch(true).catch(() => {});
    }
    if (!isEveryoneViewDenied(guild, channel)) {
      console.warn(`${tag} @everyone can still view #${channel.name} — check category overwrites`);
      return false;
    }
    return true;
  } catch (err) {
    const denied = err.code === 50001 || err.code === 50013
      || /missing access/i.test(String(err.message));
    if (denied) {
      console.warn(`${tag} Cannot deny @everyone View Channel on #${channel.name}`);
      return false;
    }
    throw err;
  }
}

function isActingMasterBot(guild) {
  const me = guild.members.me;
  if (!me) return false;
  const masterId = require('../bridge/registry').state.master?.client?.user?.id;
  return masterId === me.user.id;
}

/** Bot must outrank the role to set a role overwrite on a channel. */
function botCanGrantRoleOverwrite(guild, channel, roleId) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return false;
  if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) return false;
  if (roleId === guild.id) return true;
  const role = guild.roles.cache.get(roleId);
  if (!role) return true;
  return me.roles.highest.comparePositionTo(role) > 0;
}

/** Channel create: hide @everyone + allow @Oud Entry — bots get the role at guild level. */
function hiddenRoomOverwrites(guild, oudRoleId) {
  return [
    everyoneDenyViewOverwrite(guild.id),
    roleAllowOverwrite(oudRoleId),
  ];
}

function hiddenRoomCreateOverwrites(guild, oudRoleId) {
  return hiddenRoomOverwrites(guild, oudRoleId);
}

function overwriteHasEntryAllows(channel, targetId) {
  const ow = channel.permissionOverwrites?.cache?.get(targetId);
  if (!ow) return false;
  return ENTRY_ROLE_PERM_BITS.every(bit => ow.allow.has(bit) && !ow.deny.has(bit));
}

function memberHasBotChannelAccess(channel, member) {
  if (!member) return false;
  if (overwriteHasEntryAllows(channel, member.id)) return true;
  const perms = channel.permissionsFor(member);
  if (!perms) return false;
  return ENTRY_ROLE_PERM_BITS.every(bit => perms.has(bit));
}

function roleHasBotChannelAccess(channel, role) {
  if (!role) return false;
  if (overwriteHasEntryAllows(channel, role.id)) return true;
  const perms = channel.permissionsFor(role);
  if (!perms) return false;
  return ENTRY_ROLE_PERM_BITS.every(bit => perms.has(bit));
}

async function upsertRoleChannelAccess(guild, channel, roleId, tag, reason, { quiet = false } = {}) {
  if (!botCanGrantRoleOverwrite(guild, channel, roleId)) return false;
  // Already set (every room bot calls this at boot for the same room): no API call.
  if (overwriteHasEntryAllows(channel, roleId)) return true;

  const options = entryRoleAllowOptions();
  const audit = { reason, type: OverwriteType.Role };

  try {
    await channel.permissionOverwrites.edit(roleId, options, audit);

    await channel.fetch(true).catch(() => {});
    const role = guild.roles.cache.get(roleId)
      ?? await guild.roles.fetch(roleId).catch(() => null);
    if (!roleHasBotChannelAccess(channel, role)) {
      if (!quiet) {
        console.warn(
          `${tag} Role overwrite set but #${channel.name} still blocks @${role?.name ?? roleId}`,
        );
      }
      return false;
    }
    return true;
  } catch (err) {
    const denied = err.code === 50001 || err.code === 50013
      || /missing access/i.test(String(err.message));
    if (denied) {
      if (!quiet) {
        const roleName = guild.roles.cache.get(roleId)?.name;
        // Discord only lets the bot allow what it has itself in this room: name what is missing.
        const mine = channel.permissionsFor(guild.members.me);
        const lacking = Object.entries(PermissionFlagsBits)
          .filter(([, bit]) => [...ENTRY_ROLE_PERM_BITS, PermissionFlagsBits.ManageRoles].includes(bit) && !mine?.has(bit))
          .map(([name]) => name);
        // An edit keeps the role's existing allows: one the bot does not have itself fails the whole edit.
        const ow = channel.permissionOverwrites?.cache?.get(roleId);
        // Same for denies: Discord checks every bit the edited overwrite allows or denies.
        for (const name of [...(ow?.allow?.toArray?.() || []), ...(ow?.deny?.toArray?.() || [])]) {
          if (!mine?.has(PermissionFlagsBits[name]) && !lacking.includes(name)) lacking.push(name);
        }
        logOnce(`roleow:${guild.id}:${channel.id}:${roleId}`, 6 * 3600_000, () => console.warn(`${tag} Cannot set role overwrite for @${roleName ?? '?'} (${roleId}) on #${channel.name} in ${guild.name}: ${err.message}${lacking.length ? ` — bot lacks in this room: ${lacking.join(', ')}` : ''}`));
        require('./ownerNotice').notifyRoomAccessProblem(guild, tag, { channel }).catch(() => {});
      }
      return false;
    }
    throw err;
  }
}

/** Explicit @oud role allows on a channel (green checks in Discord UI). */
async function syncSubscriberRoleAccess(guild, channel, guildId, botKey, tag = '[ROOM]') {
  const guildChannelsStore = require('./guildChannelsStore');
  const cfg = botKey === 'master'
    ? guildChannelsStore.getMaster(guildId)
    : guildChannelsStore.getSlave(guildId, botKey);
  const roleIds = cfg?.allowedRoleIds;
  if (!Array.isArray(roleIds) || !roleIds.length) return;
  for (const roleId of roleIds) {
    if (!roleId || !guild.roles.cache.has(String(roleId))) continue;
    await upsertRoleChannelAccess(
      guild,
      channel,
      roleId,
      tag,
      'Subscription: room access',
    );
  }
}

async function upsertOudRoleChannelAccess(guild, channel, tag = '[ROOM]', { quiet = false } = {}) {
  const oud = await ensureOudRole(guild, tag);
  const ok = await upsertRoleChannelAccess(
    guild,
    channel,
    oud.id,
    tag,
    'Bridge: @oud room access',
    { quiet },
  );
  if (ok) {
    console.log(
      `${tag} @${oud.name} role → View, Send, Embed, Read History, Connect, Speak on #${channel.name}`,
    );
  }
  return ok ? oud : null;
}

/** External rooms: add @Oud Entry allows only — no member overwrites, no @everyone, no extra roles. */
async function grantExternalRoomEntryAccess(guild, channel, tag = '[ROOM]') {
  if (!isActingMasterBot(guild)) return null;
  if (!botCanManageChannel(guild, channel)) return null;
  return upsertOudRoleChannelAccess(guild, channel, tag, { quiet: true });
}

async function grantRoomAllowsBeforeHide(guild, channel, tag = '[ROOM]', guildId = guild?.id, botKey = 'master') {
  const oud = await ensureOudRole(guild, tag);
  await syncConnectedBotsOudRole(guild, tag);
  await upsertOudRoleChannelAccess(guild, channel, tag);
  if (guildId) await syncSubscriberRoleAccess(guild, channel, guildId, botKey, tag);
  return oud;
}

async function syncOudRoomAllows(guild, channel, tag = '[ROOM]', guildId = guild?.id, botKey = 'master') {
  const oud = await grantRoomAllowsBeforeHide(guild, channel, tag, guildId, botKey);
  console.log(`${tag} Synced @${oud.name} on #${channel.name} — bots via guild role, @everyone not modified`);
  return oud;
}

async function applyHiddenRoomAccess(guild, channel, tag = '[ROOM]', guildId = guild?.id, botKey = 'master') {
  const oud = await grantRoomAllowsBeforeHide(guild, channel, tag, guildId, botKey);
  const hidden = await denyEveryoneViewChannel(guild, channel, tag);
  if (hidden) {
    console.log(`${tag} Hidden access on #${channel.name} (@${oud.name}) — @everyone cannot view`);
  } else {
    console.warn(`${tag} Partial access on #${channel.name} (@${oud.name}) — @everyone may still see the room`);
  }
  return oud;
}

/** True only when the bot has Manage Channels effective on this exact channel. */
function botCanManageChannel(guild, channel) {
  const me = guild?.members?.me;
  if (!me || !channel) return false;
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return false;
  return Boolean(channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels));
}

/** Everything the Master needs to actually join AND organize/hide a room. */
const MASTER_ROOM_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['Connect', PermissionFlagsBits.Connect],
  ['Speak', PermissionFlagsBits.Speak],
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
];

/** Names of the Master-room perms the bot is missing on this exact channel. */
function masterRoomMissingPerms(guild, channel) {
  const me = guild?.members?.me;
  if (!me || !channel) return ['bot_not_ready'];
  const perms = channel.permissionsFor(me);
  if (!perms) return ['no_permissions'];
  return MASTER_ROOM_PERMS.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

/** Missing Manage Channels/Roles — cannot repair by re-syncing allows. */
function isStructuralMasterGap(guild, channel) {
  const missing = masterRoomMissingPerms(guild, channel);
  return missing.some(m =>
    m === 'ManageChannels' || m === 'ManageRoles' || m === 'bot_not_ready' || m === 'no_permissions',
  );
}

/** True when the bot can both join and organize this channel as a Master room. */
function botCanUseMasterRoom(guild, channel) {
  return masterRoomMissingPerms(guild, channel).length === 0;
}

/** Best-effort: explain in the room why the bot can't organize it. */
async function notifyCannotOrganize(guild, channel) {
  const me = guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const canSend = perms?.has(PermissionFlagsBits.ViewChannel)
    && perms?.has(PermissionFlagsBits.SendMessages);
  if (!canSend) return;
  const { t } = require('../i18n/context');
  await channel.send(t('room.cannotOrganize')).catch(() => {});
}

/** Voice join requirements for slaves (no manage/hide needed). */
const SLAVE_VOICE_PERMS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['Connect', PermissionFlagsBits.Connect],
  ['Speak', PermissionFlagsBits.Speak],
];

/** Names of voice-join perms missing for member on this channel. */
function slaveVoiceMissingPerms(guild, channel, member = null) {
  const me = member ?? guild?.members?.me;
  if (!me || !channel) return ['bot_not_ready'];
  const perms = channel.permissionsFor(me);
  if (!perms) return ['no_permissions'];
  return SLAVE_VOICE_PERMS.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

/** True when the bot member can join and speak in this voice channel. */
function botCanJoinVoiceRoom(guild, channel, member = null) {
  return slaveVoiceMissingPerms(guild, channel, member).length === 0;
}

/** Best-effort: explain in the room why the bot can't join. */
async function notifyCannotJoinVoice(guild, channel, member = null) {
  const me = member ?? guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const canSend = perms?.has(PermissionFlagsBits.ViewChannel)
    && perms?.has(PermissionFlagsBits.SendMessages);
  if (!canSend) return;
  const { t } = require('../i18n/context');
  await channel.send(t('room.cannotJoin')).catch(() => {});
}

function botCanUseChannelChat(guild, channel) {
  const me = guild.members.me;
  if (!me || !channel) return { ok: false, missing: ['bot_not_ready'] };
  const perms = channel.permissionsFor(me);
  if (!perms) return { ok: false, missing: ['no_permissions'] };
  const needed = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ['SendMessages', PermissionFlagsBits.SendMessages],
  ];
  const missing = needed.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
  return { ok: missing.length === 0, missing };
}

function getBotTopRoleName(guild) {
  const me = guild?.members?.me;
  const top = me?.roles?.highest;
  if (!top || top.id === guild.id) return 'Oud Bot';
  return top.name;
}

function isOudRoleAboveBot(guild) {
  const me = guild?.members?.me;
  const oud = guild?.roles?.cache?.find(r => r.name === OUD_ROLE_NAME());
  if (!me || !oud) return false;
  return oud.position >= me.roles.highest.position;
}

const roomAccessHelpSent = new Set();

function shouldSendRoomAccessHelp(guildId, channelId, kind) {
  const key = `${guildId}:${channelId}:${kind}`;
  if (roomAccessHelpSent.has(key)) return false;
  roomAccessHelpSent.add(key);
  setTimeout(() => roomAccessHelpSent.delete(key), 30 * 60 * 1000);
  return true;
}

/** Channel overwrites differ from parent category (Discord "not synced"). */
function isCategoryPermissionOutOfSync(channel) {
  if (!channel?.parentId) return false;
  const parent = channel.parent
    ?? channel.guild?.channels?.cache?.get(channel.parentId);
  if (!parent) return false;

  for (const ow of channel.permissionOverwrites.cache.values()) {
    const parentOw = parent.permissionOverwrites.cache.get(ow.id);
    if (!parentOw) {
      if (ow.id !== channel.guild.id) return true;
      continue;
    }
    if (parentOw.allow.bitfield !== ow.allow.bitfield
      || parentOw.deny.bitfield !== ow.deny.bitfield) {
      return true;
    }
  }
  return false;
}

function hasMemberOverwrite(channel, userId) {
  const ow = channel.permissionOverwrites?.cache?.get(userId);
  return ow?.type === OverwriteType.Member;
}

function diagnoseSlaveRoomAccess(guild, channel, member) {
  const issues = [];
  if (!guild || !channel || !member) return issues;

  if (isCategoryPermissionOutOfSync(channel)) {
    const category = channel.parent?.name
      ?? channel.guild?.channels?.cache?.get(channel.parentId)?.name
      ?? 'category';
    issues.push({ kind: 'category_out_of_sync', category });
  }
  if (hasMemberOverwrite(channel, member.id)) {
    issues.push({
      kind: 'member_overwrite',
      botLabel: member.user?.tag ?? member.id,
    });
  }
  const oud = guild.roles.cache.find(r => r.name === OUD_ROLE_NAME());
  if (oud && !roleHasBotChannelAccess(channel, oud)) {
    issues.push({ kind: 'entry_role_channel' });
  }
  if (isActingMasterBot(guild) && !botCanManageChannel(guild, channel)) {
    issues.push({ kind: 'manage_channels' });
  }
  return issues;
}

async function resolveRoomNotifyChannel(guild, channel) {
  const me = guild.members.me;
  if (channel && me) {
    const perms = channel.permissionsFor(me);
    if (perms?.has(PermissionFlagsBits.ViewChannel)
      && perms?.has(PermissionFlagsBits.SendMessages)) {
      return channel;
    }
  }
  const { getMasterChannels } = require('../config/channels');
  const masterId = getMasterChannels(guild.id).textChannelId;
  const master = masterId ? guild.channels.cache.get(masterId) : null;
  if (master && me) {
    const perms = master.permissionsFor(me);
    if (perms?.has(PermissionFlagsBits.ViewChannel)
      && perms?.has(PermissionFlagsBits.SendMessages)) {
      return master;
    }
  }
  return channel;
}

async function notifySlaveRoomAccessIssues(guild, channel, opts = {}) {
  const { botUserId, botLabel, missing = '', tag = '[ROOM]' } = opts;
  if (!guild || !channel) return;

  const member = botUserId
    ? (guild.members.cache.get(botUserId)
      ?? await guild.members.fetch(botUserId).catch(() => null))
    : null;
  if (!member) return;
  if (botCanJoinVoiceRoom(guild, channel, member)) return;
  if (!shouldSendRoomAccessHelp(guild.id, channel.id, `slave:${member.id}`)) return;

  const { t } = require('../i18n/context');
  const issues = diagnoseSlaveRoomAccess(guild, channel, member);
  const botRole = getBotTopRoleName(guild);
  const entryRole = OUD_ROLE_NAME();
  const channelLabel = `#${channel.name}`;
  const label = botLabel ?? member.user?.tag ?? member.id;

  const noteLines = [];
  for (const issue of issues) {
    if (issue.kind === 'category_out_of_sync') {
      noteLines.push(t('room.issueCategoryOutOfSync', { category: issue.category }));
    } else if (issue.kind === 'member_overwrite') {
      noteLines.push(t('room.issueMemberOverwrite', { botLabel: issue.botLabel ?? label }));
    } else if (issue.kind === 'entry_role_channel') {
      noteLines.push(t('room.issueEntryRoleChannel', { entryRole }));
    } else if (issue.kind === 'manage_channels') {
      noteLines.push(t('room.issueManageChannels', { botRole }));
    }
  }
  if (!noteLines.length && missing) {
    noteLines.push(t('room.issueMissingPerms', { missing }));
  }

  const text = t('room.slaveAccessNote', {
    botLabel: label,
    channel: channelLabel,
    missing: missing || 'ViewChannel',
    notes: noteLines.join('\n'),
  });

  const target = await resolveRoomNotifyChannel(guild, channel);
  if (target) await target.send(text).catch(() => {});
  console.warn(`${tag} Room access note for ${label} on #${channel.name}`);
}

async function notifyRoomAccessHelp(guild, channel, tag = '[ROOM]', kind = 'hierarchy') {
  if (!guild || !channel) return;
  if (!shouldSendRoomAccessHelp(guild.id, channel.id, kind)) return;
  const { t } = require('../i18n/context');
  const botRole = getBotTopRoleName(guild);
  const entryRole = OUD_ROLE_NAME();
  const text = kind === 'manage_channels'
    ? t('room.accessHelpManage', { botRole, entryRole })
    : t('room.accessHelpHierarchy', { botRole, entryRole });
  await channel.send(text).catch(() => {});
}

async function warnIfBotCannotChat(guild, channel, tag = '[ROOM]', userId = null) {
  const uid = userId ?? guild.members.me?.user?.id;
  if (!uid || !channel) return { ok: false, missing: ['no_target'] };
  const member = guild.members.cache.get(uid)
    ?? await guild.members.fetch(uid).catch(() => null);
  const perms = member ? channel.permissionsFor(member) : null;
  if (!perms) return { ok: false, missing: ['no_permissions'] };
  const needed = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ['SendMessages', PermissionFlagsBits.SendMessages],
  ];
  const missing = needed.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
  if (missing.length) {
    console.warn(
      `${tag} Bot ${member?.user?.tag ?? uid} cannot read/send in #${channel.name} — missing: ${missing.join(', ')}. `
      + 'Grant @' + OUD_ROLE_NAME() + ' on the bot or allow View/Send on this channel.',
    );
  }
  return { ok: missing.length === 0, missing };
}

/** Grant @Oud Entry guild role — bots inherit channel access from role overwrite. */
async function grantOudEntryRole(guild, userId, tag = '[ROOM]') {
  if (!guild || !userId || !isActingMasterBot(guild)) return false;

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.warn(`${tag} Cannot grant @${OUD_ROLE_NAME()} — missing Manage Roles`);
    return false;
  }

  const oud = await ensureOudRole(guild, tag);
  if (me.roles.highest.comparePositionTo(oud) <= 0) {
    console.warn(`${tag} Cannot grant @${oud.name} — bot role must be above entry role`);
    if (isOudRoleAboveBot(guild)) {
      const ch = guild.channels.cache.find(c => isOudManagedRoom(c));
      if (ch) await notifyRoomAccessHelp(guild, ch, tag, 'hierarchy');
    }
    return false;
  }

  const member = guild.members.cache.get(userId)
    ?? await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  if (member.roles.cache.has(oud.id)) return true;

  try {
    await member.roles.add(oud, 'Bridge: bot room access via @Oud Entry');
    console.log(`${tag} Granted @${oud.name} → ${member.user?.tag ?? userId}`);
    return true;
  } catch (err) {
    const denied = err.code === 50001 || err.code === 50013
      || /missing access/i.test(String(err.message));
    if (denied) {
      console.warn(`${tag} Could not grant @${oud.name} to ${member.user?.tag ?? userId}: ${err.message}`);
      return false;
    }
    throw err;
  }
}

async function syncConnectedBotsOudRole(guild, tag = '[ROOM]') {
  if (!guild || !isActingMasterBot(guild)) return;
  const registry = require('../bridge/registry');
  const me = guild.members.me;
  if (me?.user?.id) await grantOudEntryRole(guild, me.user.id, tag);
  for (const [, entry] of registry.state.slaves) {
    if (String(entry.cfg?.guildId) !== String(guild.id)) continue;
    const id = entry.client?.user?.id;
    if (id) await grantOudEntryRole(guild, id, tag);
  }
}

function slaveBotUserId(guildId, slaveKey) {
  const registry = require('../bridge/registry');
  const gid = String(guildId);
  const key = String(slaveKey);
  for (const [, entry] of registry.state.slaves) {
    if (String(entry.cfg?.guildId) !== gid) continue;
    if (String(entry.cfg?.name) === key || String(entry.name) === key) {
      return entry.client?.user?.id ?? null;
    }
  }
  return null;
}

async function syncOudRoleGuildPermissions(role, tag = '[ROOM]') {
  if (!role?.editable) return;
  // T59: only add bits the bot itself has (Discord refuses to grant others), and never let this
  // nickname nicety fail the room access setup ("Missing Permissions" blocked whole servers).
  const mine = role.guild?.members?.me?.permissions;
  const needed = PermissionsBitField.resolve(ENTRY_GUILD_PERM_BITS.filter(bit => !mine || mine.has(bit)));
  const merged = role.permissions.add(needed);
  if (role.permissions.equals(merged)) return;
  try {
    await role.setPermissions(merged, { reason: 'Oud: allow bots to set server nicknames' });
    console.log(`${tag} @${role.name} guild role → Change Nickname enabled`);
  } catch (err) {
    logOnce(`oudrolePerms:${role.guild?.id}`, 6 * 3600_000, () => console.warn(`${tag} Could not update @${role.name} server permissions in ${role.guild?.name}: ${err.message} (room access still applied)`));
  }
}

async function ensureOudRolePosition(guild, role, tag = '[ROOM]') {
  const me = guild.members.me;
  if (!me || !role?.editable) return;
  const botTop = me.roles.highest;
  if (!botTop || botTop.id === guild.id) return;
  if (role.position < botTop.position) return;
  try {
    await role.setPosition(Math.max(0, botTop.position - 1), {
      reason: 'Oud: entry role must stay below bot role',
    });
    console.log(`${tag} Moved @${role.name} below @${botTop.name}`);
  } catch (err) {
    console.warn(`${tag} Could not move @${role.name} below bot role: ${err.message}`);
  }
}

async function ensureOudRole(guild, tag = '[ROOM]') {
  const name = OUD_ROLE_NAME();
  let role = guild.roles.cache.find(r => r.name === name);
  if (!role) {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      throw new Error('Manage Roles required to create the bridge access role.');
    }
    role = await guild.roles.create({
      name,
      reason: 'Bridge: optional human room access role',
      position: me.roles.highest.position > 0 ? me.roles.highest.position - 1 : undefined,
    });
    console.log(`${tag} Created role @${role.name} (${role.id})`);
  }
  await ensureOudRolePosition(guild, role, tag);
  await syncOudRoleGuildPermissions(role, tag);
  return role;
}

async function mergeBridgeRoomBotAccess(guild, channel, tag = '[ROOM]') {
  if (!botCanManageChannel(guild, channel)) return null;
  try {
    return grantExternalRoomEntryAccess(guild, channel, tag);
  } catch (err) {
    const denied = err.code === 50001 || err.code === 50013
      || /missing access/i.test(String(err.message));
    if (denied) return null;
    throw err;
  }
}

function resolveManageGuild(guild) {
  if (!guild?.id) return guild;
  const master = require('../bridge/registry').state.master?.client;
  if (!master) return guild;
  return master.guilds.cache.get(guild.id) ?? guild;
}

async function prepareAssignedVoiceRoom(guild, channelOrId, opts = {}) {
  const {
    botUserId = null,
    hideFromEveryone = false,
    tag = '[ROOMS]',
    syncEntryPerms = true,
  } = opts;
  const mg = resolveManageGuild(guild);
  if (!mg) return null;
  // Always act on the main bot's copy of the room: a channel object from a room bot's client sends
  // the edit with the room bot's token, which has no Manage Roles ("Cannot set role overwrite").
  const id = typeof channelOrId === 'string' ? channelOrId : channelOrId?.id;
  const channel = (id && mg.channels.cache.get(id))
    || (typeof channelOrId === 'string' ? await mg.channels.fetch(id).catch(() => null) : channelOrId);
  if (!channel) return null;

  if (!isActingMasterBot(mg)) {
    return channel;
  }

  try {
    if (isOudManagedRoom(channel)) {
      await syncBridgeRoomAccess(mg, channel, tag);
    } else if (syncEntryPerms) {
      await mergeBridgeRoomBotAccess(mg, channel, tag);
    }
  } catch (err) {
    logOnce(`roomaccess:${mg.id}:${channel.id}:${err.message}`, 3600_000, () => console.warn(`${tag} Room access failed in ${mg.name} for #${channel.name}: ${err.message}`));
  }

  if (botUserId && isOudManagedRoom(channel)) {
    await grantBotRoomAccess(mg, channel, botUserId, tag).catch(() => {});
  }
  return channel;
}

async function grantBotRoomAccess(guild, channelOrId, userId, tag = '[ROOM]') {
  if (!guild || !userId) return { ok: false, reason: 'missing' };

  const ok = await grantOudEntryRole(guild, userId, tag);
  if (!ok) return { ok: false, reason: 'role_failed' };

  let channel = typeof channelOrId === 'string'
    ? guild.channels.cache.get(channelOrId)
    : channelOrId;
  if (!channel && typeof channelOrId === 'string') {
    channel = await guild.channels.fetch(channelOrId).catch(() => null);
  }
  if (channel) await warnIfBotCannotChat(guild, channel, tag, userId);
  return { ok: true };
}

const syncedHiddenRooms = new Set();

function roomSyncKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

function clearRoomSyncCache(guildId, channelId) {
  syncedHiddenRooms.delete(roomSyncKey(guildId, channelId));
}

async function syncBridgeRoomAccessOnce(guild, channel, tag = '[ROOM]', { force = false } = {}) {
  const key = roomSyncKey(guild.id, channel.id);
  if (!force && syncedHiddenRooms.has(key)) return null;
  try {
    const result = await syncBridgeRoomAccess(guild, channel, tag);
    if (result) syncedHiddenRooms.add(key);
    else syncedHiddenRooms.delete(key);
    return result;
  } catch (err) {
    syncedHiddenRooms.delete(key);
    throw err;
  }
}

async function syncBridgeRoomAccess(guild, channel, tag = '[ROOM]') {
  const me = guild.members.me;
  if (!me) return null;

  if (!isOudManagedRoom(channel)) {
    return mergeBridgeRoomBotAccess(guild, channel, tag);
  }

  const canManage = channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels);
  if (!canManage) {
    console.warn(`${tag} No Manage Channels on #${channel.name} — merging @${OUD_ROLE_NAME()} access only`);
    return mergeBridgeRoomBotAccess(guild, channel, tag);
  }

  const oud = await ensureOudRole(guild, tag);
  try {
    return await syncOudRoomAllows(guild, channel, tag, guild.id, 'master');
  } catch (err) {
    const denied = err.code === 50001 || err.code === 50013
      || /missing access/i.test(String(err.message));
    if (denied) {
      console.warn(`${tag} Hidden overwrite blocked on #${channel.name} — merging @${oud.name} access only`);
      await mergeBridgeRoomBotAccess(guild, channel, tag);
    } else {
      throw err;
    }
  }
  return oud;
}

async function bootstrapBridgeRoomAccess(guild, tag = '[MASTER]') {
  const { getMasterChannels } = require('../config/channels');
  const voiceChannelId = getMasterChannels(guild.id).voiceChannelId;
  if (!voiceChannelId) return;

  let channel = guild.channels.cache.get(voiceChannelId);
  if (!channel) {
    channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
  }
  if (!channel) return;

  const syncFn = isOudManagedRoom(channel)
    ? () => syncOudRoomAllows(guild, channel, tag, guild.id, 'master')
    : () => mergeBridgeRoomBotAccess(guild, channel, tag);

  await syncFn().catch(err => {
    console.warn(`${tag} Room access refresh failed: ${err.message}`);
  });

  await syncConnectedBotsOudRole(guild, tag);

  const me = guild.members.me;
  if (me?.user?.id) {
    await warnIfBotCannotChat(guild, channel, tag, me.user.id);
  }
  for (const [, entry] of require('../bridge/registry').state.slaves) {
    const id = entry.client?.user?.id;
    if (id) await warnIfBotCannotChat(guild, channel, entry.tag || tag, id);
  }
}

async function grantOudToBot(guild, userId, tag = '[ROOM]') {
  const { getMasterChannels } = require('../config/channels');
  const voiceChannelId = getMasterChannels().voiceChannelId;
  if (!voiceChannelId) return { ok: false, reason: 'no_room' };
  return grantBotRoomAccess(guild, voiceChannelId, userId, tag);
}

async function bootstrapSlaveRoomAccess(guild, voiceChannelId, slaveKey, tag = '[GLOBAL]') {
  if (!voiceChannelId) return;
  let channel = guild.channels.cache.get(voiceChannelId);
  if (!channel) {
    channel = await guild.channels.fetch(voiceChannelId).catch(() => null);
  }
  if (!channel) return;

  if (isOudManagedRoom(channel)) {
    await syncBridgeRoomAccessOnce(guild, channel, tag, { force: true }).catch(() => {});
  } else {
    await mergeBridgeRoomBotAccess(guild, channel, tag).catch(() => {});
  }

  const botUserId = slaveBotUserId(guild.id, slaveKey);
  if (botUserId) await grantOudEntryRole(guild, botUserId, tag);
}

/** Master + slave voice/text rooms that should get channel-level @Oud Entry sync. */
function listTrackedBridgeChannelIds(guildId) {
  const gid = String(guildId);
  /** @type {Map<string, { kind: 'master' | 'slave', slaveKey?: string }>} */
  const out = new Map();
  const { getGuildMasterChannels } = require('../config/channels');
  const guildChannelsStore = require('./guildChannelsStore');

  const master = getGuildMasterChannels(gid);
  if (master.voiceChannelId) out.set(master.voiceChannelId, { kind: 'master' });
  if (master.textChannelId && master.textChannelId !== master.voiceChannelId) {
    out.set(master.textChannelId, { kind: 'master' });
  }

  for (const [slaveKey, cfg] of Object.entries(guildChannelsStore.getGuild(gid).slaves || {})) {
    const vid = cfg?.voiceChannelId?.trim();
    if (vid) out.set(vid, { kind: 'slave', slaveKey: String(slaveKey) });
  }

  try {
    const registry = require('../bridge/registry');
    for (const [, entry] of registry.state.slaves) {
      if (String(entry.cfg?.guildId) !== gid) continue;
      const vid = entry.cfg?.channelId?.trim();
      const name = String(entry.cfg?.name ?? entry.name ?? '');
      if (vid && !out.has(vid)) out.set(vid, { kind: 'slave', slaveKey: name });
    }
  } catch { /* ignore */ }

  return out;
}

/**
 * Re-apply channel-level permission overwrites after a category move (or manual sync).
 * Never writes to the category — only the channel's permissionOverwrites.
 */
async function resyncTrackedChannelAccess(guild, channelId, tag = '[GLOBAL]') {
  if (!guild || !channelId) return false;
  const tracked = listTrackedBridgeChannelIds(guild.id);
  const meta = tracked.get(String(channelId));
  if (!meta) return false;

  clearRoomSyncCache(guild.id, channelId);

  let channel = guild.channels.cache.get(channelId);
  if (!channel) {
    channel = await guild.channels.fetch(channelId).catch(() => null);
  }
  if (!channel) return false;

  if (meta.kind === 'master') {
    await syncBridgeRoomAccessOnce(guild, channel, tag, { force: true });
    await syncConnectedBotsOudRole(guild, tag);
  } else {
    await bootstrapSlaveRoomAccess(guild, channelId, meta.slaveKey, tag);
  }

  const me = guild.members.me;
  if (me?.user?.id) {
    await warnIfBotCannotChat(guild, channel, tag, me.user.id);
  }
  return true;
}

const categoryResyncTimers = new Map();

/** Debounced resync when a tracked channel's parent category changes. */
function scheduleTrackedChannelResync(guild, channelId, tag = '[GLOBAL]') {
  if (!guild?.id || !channelId) return;
  const key = `${guild.id}:${channelId}`;
  const existing = categoryResyncTimers.get(key);
  if (existing) clearTimeout(existing);
  categoryResyncTimers.set(key, setTimeout(() => {
    categoryResyncTimers.delete(key);
    resyncTrackedChannelAccess(guild, channelId, tag).catch((err) => {
      console.warn(`${tag} Channel resync after category move failed (${channelId}): ${err.message}`);
    });
  }, 600));
}

module.exports = {
  OUD_ROLE_NAME,
  ensureOudRole,
  hiddenRoomCreateOverwrites,
  denyEveryoneViewChannel,
  isEveryoneViewDenied,
  applyHiddenRoomAccess,
  botCanUseChannelChat,
  botCanManageChannel,
  botCanUseMasterRoom,
  isStructuralMasterGap,
  masterRoomMissingPerms,
  botCanJoinVoiceRoom,
  slaveVoiceMissingPerms,
  notifyCannotOrganize,
  notifyCannotJoinVoice,
  notifySlaveRoomAccessIssues,
  diagnoseSlaveRoomAccess,
  warnIfBotCannotChat,
  syncBridgeRoomAccess,
  syncBridgeRoomAccessOnce,
  clearRoomSyncCache,
  mergeBridgeRoomBotAccess,
  prepareAssignedVoiceRoom,
  grantBotRoomAccess,
  grantOudEntryRole,
  syncConnectedBotsOudRole,
  upsertOudRoleChannelAccess,
  upsertRoleChannelAccess,
  grantOudToBot,
  bootstrapBridgeRoomAccess,
  bootstrapSlaveRoomAccess,
  syncSubscriberRoleAccess,
  listTrackedBridgeChannelIds,
  resyncTrackedChannelAccess,
  scheduleTrackedChannelResync,
};
