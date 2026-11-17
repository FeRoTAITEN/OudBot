const { ChannelType } = require('discord.js');
const subscriptionStore = require('./subscriptionStore');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { getGuildMasterChannels, isTextChannelValid } = require('../config/channels');
const { parseSlaveQueueKey, slaveQueueKey } = require('../music/slaveQueueKey');
const { queueKeyForGuild } = require('../music/queueKey');
const { isSlaveOnMasterFallback } = require('../panel/slaveRoomBootstrap');
const { t } = require('../i18n/context');

function getMusicRoomChannels(guildId, queueKey) {
  const parsed = queueKey ? parseSlaveQueueKey(queueKey) : null;
  if (parsed?.name) {
    const gid = parsed.guildId || guildId;
    const slave = guildChannelsStore.getSlave(gid, parsed.name);
    if (slave?.voiceChannelId) {
      const voiceChannelId = slave.voiceChannelId.trim();
      if (isSlaveOnMasterFallback(gid, parsed.name)) {
        return { voiceChannelId, textChannelId: null, chatSilenced: true };
      }
      const textChannelId = slave.textChannelId?.trim()
        || voiceChannelId;
      return { voiceChannelId, textChannelId, chatSilenced: false };
    }
  }
  return getGuildMasterChannels(guildId);
}

function isSlaveMusicChatSilenced(guildId, queueKey) {
  const parsed = queueKey ? parseSlaveQueueKey(queueKey) : null;
  if (!parsed?.name) return false;
  const gid = parsed.guildId || guildId;
  return isSlaveOnMasterFallback(gid, parsed.name);
}

function isVoiceChannelId(guild, channelId) {
  if (!guild || !channelId) return false;
  const ch = guild.channels.cache.get(channelId);
  return ch?.type === ChannelType.GuildVoice;
}

async function resolveMemberAsync(member, guild, userId) {
  if (member) return member;
  if (!guild || !userId) return null;
  return guild.members.cache.get(userId)
    ?? await guild.members.fetch(userId).catch(() => null);
}

function textChannelMatches(guild, channelId, textChannelId, voiceChannelId) {
  if (!channelId) return false;
  if (textChannelId && channelId === textChannelId) return true;
  if (voiceChannelId && channelId === voiceChannelId) return true;
  return false;
}

/**
 * Music access: subscribed + assigned text channel + user in assigned voice room.
 */
async function checkMusicAccess({ guild, member, userId, channelId, queueKey = null }) {
  if (!guild) return { ok: false, reason: 'no_guild' };

  const features = subscriptionStore.getGuildFeatures(guild.id);
  if (!features.allowed) {
    return { ok: false, reason: features.expired ? 'expired' : 'sub' };
  }

  if (!features.music) {
    return { ok: false, reason: 'sub' };
  }

  const ch = getMusicRoomChannels(guild.id, queueKey);
  if (!ch.voiceChannelId) {
    return { ok: false, reason: 'no_room' };
  }

  const textId = ch.textChannelId || ch.voiceChannelId;
  if (!textChannelMatches(guild, channelId, textId, ch.voiceChannelId)) {
    return { ok: false, reason: 'text', textChannelId: textId };
  }

  const mem = await resolveMemberAsync(member, guild, userId);
  const voiceId = mem?.voice?.channelId;
  if (!voiceId || voiceId !== ch.voiceChannelId) {
    return { ok: false, reason: 'voice', voiceChannelId: ch.voiceChannelId };
  }

  return {
    ok: true,
    voiceChannelId: ch.voiceChannelId,
    textChannelId: textId,
  };
}

function formatAccessDeny(reason, guild, queueKey = null) {
  switch (reason) {
    case 'sub': {
      const url = process.env.SUBSCRIPTION_URL?.trim();
      return url ? t('sub.notSubscribedUrl', { url }) : t('sub.notSubscribed');
    }
    case 'expired':
      return t('sub.expired');
    case 'text': {
      const ch = getMusicRoomChannels(guild?.id, queueKey);
      const label = guild?.channels?.cache?.get(ch.textChannelId)?.name
        ?? guild?.channels?.cache?.get(ch.voiceChannelId)?.name
        ?? 'assigned chat';
      return t('music.useRoomText', { channel: label });
    }
    case 'voice': {
      const ch = getMusicRoomChannels(guild?.id, queueKey);
      const label = guild?.channels?.cache?.get(ch.voiceChannelId)?.name ?? 'assigned voice room';
      return t('music.joinVoice', { channel: label });
    }
    case 'no_room':
      return t('music.roomNotReady');
    default:
      return t('sub.notSubscribed');
  }
}

/** Panel: subscribed guild only */
function checkPanelGuild(guildId) {
  if (!guildId) return false;
  return subscriptionStore.isGuildAllowed(guildId);
}

/** Assigned text chat for music/panel — same rules as checkMusicAccess text check. */
function isAssignedMusicTextChannel(guildId, channelId, queueKey = null) {
  if (!guildId || !channelId) return false;
  const ch = getMusicRoomChannels(guildId, queueKey);
  if (!ch.voiceChannelId) return false;
  const textId = ch.textChannelId || ch.voiceChannelId;
  return textChannelMatches(null, channelId, textId, ch.voiceChannelId);
}

function sortMusicRoomCandidates(a, b) {
  if (a.kind === 'master') return -1;
  if (b.kind === 'master') return 1;
  return Number(a.name) - Number(b.name);
}

/** Master + slaves whose assigned text/voice chat matches channelId. */
function listMusicRoomsForTextChannel(guildId, channelId) {
  if (!guildId || !channelId) return [];
  const out = [];
  const master = getGuildMasterChannels(guildId);
  const masterVoice = master.voiceChannelId?.trim();
  if (masterVoice) {
    const masterText = master.textChannelId?.trim() || masterVoice;
    if (textChannelMatches(null, channelId, masterText, masterVoice)) {
      out.push({
        kind: 'master',
        queueKey: queueKeyForGuild(guildId),
        voiceChannelId: masterVoice,
        name: 'master',
      });
    }
  }
  const slaves = guildChannelsStore.getGuild(guildId).slaves || {};
  for (const [name, slave] of Object.entries(slaves)) {
    const voiceId = slave?.voiceChannelId?.trim();
    if (!voiceId || isSlaveOnMasterFallback(guildId, name)) continue;
    const textId = slave.textChannelId?.trim() || voiceId;
    if (textChannelMatches(null, channelId, textId, voiceId)) {
      out.push({
        kind: 'slave',
        queueKey: slaveQueueKey({ name, guildId }),
        voiceChannelId: voiceId,
        name,
      });
    }
  }
  return out;
}

/**
 * Pick the one bot queue that should handle a music command in this text channel.
 * Returns null when the user must be denied (not in voice / wrong room / no match).
 */
function resolveMusicQueueKey(guildId, textChannelId, userVoiceChannelId) {
  const candidates = listMusicRoomsForTextChannel(guildId, textChannelId);
  if (!candidates.length || !userVoiceChannelId) return null;

  const voiceMatches = candidates.filter(c => c.voiceChannelId === userVoiceChannelId);
  if (!voiceMatches.length) return null;

  if (voiceMatches.length === 1) return voiceMatches[0].queueKey;

  const uniqueVoices = new Set(voiceMatches.map(c => c.voiceChannelId));
  if (uniqueVoices.size === 1) {
    const sorted = [...voiceMatches].sort(sortMusicRoomCandidates);
    return sorted[0].queueKey;
  }

  return [...voiceMatches].sort(sortMusicRoomCandidates)[0].queueKey;
}

/** Stable queueKey for access-deny copy when no handler owns the command yet. */
function pickDenyQueueKey(guildId, textChannelId) {
  const candidates = listMusicRoomsForTextChannel(guildId, textChannelId);
  if (!candidates.length) return null;
  return [...candidates].sort(sortMusicRoomCandidates)[0].queueKey;
}

/** True if channelId is assigned text/voice chat for any slave room in this guild. */
function isAnySlaveMusicTextChannel(guildId, channelId) {
  if (!guildId || !channelId) return false;
  const slaves = guildChannelsStore.getGuild(guildId).slaves || {};
  for (const slave of Object.values(slaves)) {
    const voiceId = slave?.voiceChannelId?.trim();
    if (!voiceId) continue;
    const textId = slave.textChannelId?.trim() || voiceId;
    if (textChannelMatches(null, channelId, textId, voiceId)) return true;
  }
  return false;
}

function getAssignedTextChannelId(guildId, queueKey = null) {
  const ch = getMusicRoomChannels(guildId, queueKey);
  return ch.textChannelId || ch.voiceChannelId || null;
}

module.exports = {
  checkMusicAccess,
  formatAccessDeny,
  checkPanelGuild,
  isAssignedMusicTextChannel,
  isAnySlaveMusicTextChannel,
  listMusicRoomsForTextChannel,
  resolveMusicQueueKey,
  pickDenyQueueKey,
  isSlaveMusicChatSilenced,
  getAssignedTextChannelId,
};
