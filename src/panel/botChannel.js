const { ChannelType } = require('discord.js');
const { t } = require('../i18n/context');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const registry = require('../bridge/registry');
const botConfigStore = require('./botConfigStore');
const { getMasterChannels, mergeSlaveChannelCfg } = require('../config/channels');
const { updateMusicRoom } = require('../music/musicCommands');
const { botDisplayLabel } = require('./roomLabel');
const {
  prepareAssignedVoiceRoom,
  botCanUseMasterRoom,
  masterRoomMissingPerms,
  botCanJoinVoiceRoom,
  slaveVoiceMissingPerms,
  notifyCannotOrganize,
  notifyCannotJoinVoice,
  notifySlaveRoomAccessIssues,
} = require('./roomAccess');
const { resolveMasterVoiceFallback } = require('./slaveRoomBootstrap');
const { isSlaveBridgeBlocked } = require('../bridge/roomCollision');
const globalVoice = require('../bots/globalVoice');
const { isOudManagedRoom } = require('./oudRoomRegistry');
const { slaveQueueKey } = require('../music/slaveQueueKey');

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
]);

function validateVoiceChannel(guild, channelId) {
  const ch = guild?.channels?.cache?.get(channelId);
  if (!ch) throw new Error('Channel not found on this server.');
  if (ch.type !== ChannelType.GuildVoice) {
    throw new Error('Pick a voice channel, not text.');
  }
  return ch;
}

function validateTextChannel(guild, channelId) {
  const ch = guild?.channels?.cache?.get(channelId);
  if (!ch) throw new Error('Channel not found on this server.');
  if (!TEXT_CHANNEL_TYPES.has(ch.type)) {
    throw new Error('Pick a text or voice-channel chat.');
  }
  return ch;
}

function syncBotRooms(botKey, client, guildId) {
  if (botKey === 'master') {
    const ch = getMasterChannels(guildId);
    client._voiceLocker?.setChannelId(ch.voiceChannelId);
    updateMusicRoom(client, ch.voiceChannelId, ch.textChannelId);
    return ch;
  }

  const entry = registry.getSlaveEntry(guildId, String(botKey));
  if (!entry) throw new Error('Bot not connected.');
  const merged = mergeSlaveChannelCfg({ ...entry.cfg, guildId });
  entry.cfg.channelId = merged.channelId;
  entry.cfg.textChannelId = merged.textChannelId;
  entry.voice?.setChannelId(entry.cfg.channelId);
  updateMusicRoom(client, entry.cfg.channelId, entry.cfg.textChannelId, slaveQueueKey(entry.cfg));
  return entry.cfg;
}

async function slaveMemberForCheck(guild, botKey) {
  const client = registry.getSlaveEntry(guild.id, botKey)?.client;
  if (!client?.user) return null;
  return guild.members.cache.get(client.user.id)
    ?? await guild.members.fetch(client.user.id).catch(() => null);
}

async function setBotVoiceChannel(botKey, channelId, guild) {
  const key = String(botKey);
  const voiceCh = validateVoiceChannel(guild, channelId);

  let botUserId;
  if (key === 'master') {
    botUserId = registry.state.master?.client?.user?.id ?? null;
  } else {
    botUserId = registry.getSlaveEntry(guild.id, key)?.client?.user?.id ?? null;
  }

  // Oud Center needs full organize/hide. Other rooms only need join perms.
  if (key === 'master') {
    const needsOrganize = isOudManagedRoom(voiceCh);
    const canAssign = needsOrganize
      ? botCanUseMasterRoom(guild, voiceCh)
      : botCanJoinVoiceRoom(guild, voiceCh);
    if (!canAssign) {
      await notifyCannotOrganize(guild, voiceCh).catch(() => {});
      const missing = needsOrganize
        ? masterRoomMissingPerms(guild, voiceCh).join(', ')
        : slaveVoiceMissingPerms(guild, voiceCh).join(', ');
      console.warn(
        `[ROOMS:master] Cannot use #${voiceCh.name} (missing: ${missing}) — staying in own room.`,
      );
      const current = getMasterChannels(guild.id);
      return {
        label: 'Master',
        channelId: current.voiceChannelId,
        textChannelId: current.textChannelId,
        reverted: true,
        attemptedChannelId: channelId,
      };
    }
  }

  // Slave must be able to join — otherwise assign Master room instead.
  if (key !== 'master') {
    const slaveMember = await slaveMemberForCheck(guild, key);
    if (slaveMember) {
      await prepareAssignedVoiceRoom(guild, voiceCh, {
        botUserId,
        hideFromEveryone: false,
        tag: `[ROOMS:${key}]`,
      });
      const refreshed = await guild.members.fetch(slaveMember.id).catch(() => slaveMember);
      if (!botCanJoinVoiceRoom(guild, voiceCh, refreshed)) {
        const missing = slaveVoiceMissingPerms(guild, voiceCh, refreshed).join(', ');
        const label = botDisplayLabel(guild, key);
        await notifySlaveRoomAccessIssues(guild, voiceCh, {
          botUserId: refreshed.id,
          botLabel: label,
          missing,
          tag: `[ROOMS:${key}]`,
        }).catch(() => {});
        console.warn(
          `[ROOMS:${key}] Can't join #${voiceCh.name} (missing: ${missing}) — falling back to Master room (chat silent)`,
        );
        const { voiceId } = await resolveMasterVoiceFallback(guild);
        await prepareAssignedVoiceRoom(guild, guild.channels.cache.get(voiceId) || voiceId, {
          botUserId,
          hideFromEveryone: false,
          tag: `[ROOMS:${key}]`,
        });
        botConfigStore.merge(key, { voiceChannelId: voiceId, textChannelId: '' }, guild.id);

        const entry = registry.getSlaveEntry(guild.id, key);
        if (!entry?.client) {
          return {
            label: botDisplayLabel(guild, key),
            channelId: voiceId,
            textChannelId: null,
            fellBackToMaster: true,
            attemptedChannelId: channelId,
            savedOnly: true,
          };
        }

        const cfg = syncBotRooms(key, entry.client, guild.id);
        return {
          label: botDisplayLabel(guild, key),
          channelId: cfg.channelId,
          textChannelId: cfg.textChannelId,
          fellBackToMaster: true,
          attemptedChannelId: channelId,
          savedOnly: false,
        };
      }
    }
  }

  await prepareAssignedVoiceRoom(guild, voiceCh, {
    botUserId,
    hideFromEveryone: key === 'master' && isOudManagedRoom(voiceCh),
    tag: `[ROOMS:${key}]`,
  });

  botConfigStore.merge(key, { voiceChannelId: channelId, textChannelId: channelId }, guild.id);

  if (key === 'master') {
    const entry = registry.state.master;
    if (!entry?.client) throw new Error(t('err.masterNotConnected'));
    const ch = syncBotRooms('master', entry.client, guild.id);
    if (entry?.client) {
      const { syncGlobalGuildRoom } = require('../music/musicCommands');
      syncGlobalGuildRoom(guild.id);
      if (!globalVoice.isGuildVoicePaused(guild.id)) {
        await globalVoice.joinAssignedGuildVoice(entry.client, guild.id).catch(err => {
          console.warn(`[ROOMS:master] Voice join: ${err.message}`);
        });
      }
    }
    return { label: 'Master', channelId: ch.voiceChannelId, textChannelId: ch.textChannelId };
  }

  const merged = mergeSlaveChannelCfg({
    name: key,
    token: '',
    guildId: guild.id,
    channelId: null,
    textChannelId: null,
  });

  const entry = registry.getSlaveEntry(guild.id, key);
  if (!entry?.client) {
    return {
      label: botDisplayLabel(guild, key),
      channelId: merged.channelId,
      textChannelId: merged.textChannelId,
      savedOnly: true,
    };
  }

  const cfg = syncBotRooms(key, entry.client, guild.id);

  return {
    label: botDisplayLabel(guild, key),
    channelId: cfg.channelId,
    textChannelId: cfg.textChannelId,
    savedOnly: false,
  };
}

function voiceChannelLabel(guild, channelId) {
  const ch = guild?.channels?.cache?.get(channelId);
  return ch ? `**#${ch.name}**` : `\`${channelId}\``;
}

/** After panel assign — wait for voice join and report organize/join outcome. */
async function confirmBotVoiceJoin(botKey, guild, channelId) {
  const key = String(botKey);
  const entry = key === 'master'
    ? registry.state.master
    : registry.getSlaveEntry(guild.id, key);
  const label = key === 'master' ? 'Master' : botDisplayLabel(guild, key);
  const voiceName = voiceChannelLabel(guild, channelId);

  if (key === 'master') {
    if (globalVoice.isGuildVoicePaused(guild.id)) {
      return { status: 'paused', label, voice: voiceName };
    }
    const gv = globalVoice.getEntry(guild.id);
    if (!gv?.connection) return { status: 'failed', label, voice: voiceName };
    const ready = gv.connection.state.status === VoiceConnectionStatus.Ready;
    if (!ready) return { status: 'failed', label, voice: voiceName };
    const ch = guild.channels.cache.get(channelId)
      ?? await guild.channels.fetch(channelId).catch(() => null);
    const organized = ch && botCanUseMasterRoom(guild, ch);
    return { status: organized ? 'master_ok' : 'master_partial', label, voice: voiceName };
  }

  const voice = entry?.voice;
  if (!voice) return { status: 'offline', label, voice: voiceName };
  if (voice.isPaused()) return { status: 'paused', label, voice: voiceName };

  const joined = await voice.waitForTargetChannel(35_000);
  if (!joined) return { status: 'failed', label, voice: voiceName };

  const ch = guild.channels.cache.get(channelId)
    ?? await guild.channels.fetch(channelId).catch(() => null);

  const slaveMember = await slaveMemberForCheck(guild, key);
  if (ch && slaveMember && !botCanJoinVoiceRoom(guild, ch, slaveMember)) {
    const missing = slaveVoiceMissingPerms(guild, ch, slaveMember).join(', ');
    return { status: 'access_failed', label, voice: voiceName, missing };
  }

  if (isSlaveBridgeBlocked(channelId, guild.id)) {
    return { status: 'collision', label, voice: voiceName };
  }

  return { status: 'ok', label, voice: voiceName };
}

async function setBotTextChannel(botKey, channelId, guild) {
  const key = String(botKey);
  validateTextChannel(guild, channelId);
  botConfigStore.merge(key, { textChannelId: channelId }, guild.id);

  if (key === 'master') {
    const entry = registry.state.master;
    if (!entry?.client) throw new Error(t('err.masterNotConnected'));
    const ch = syncBotRooms('master', entry.client, guild.id);
    return { label: 'Master', textChannelId: ch.textChannelId };
  }

  const merged = mergeSlaveChannelCfg({
    name: key,
    token: '',
    guildId: guild.id,
    channelId: null,
    textChannelId: null,
  });

  const entry = registry.getSlaveEntry(guild.id, key);
  if (!entry?.client) {
    return {
      label: botDisplayLabel(guild, key),
      textChannelId: merged.textChannelId,
      savedOnly: true,
    };
  }

  const cfg = syncBotRooms(key, entry.client, guild.id);
  return {
    label: botDisplayLabel(guild, key),
    textChannelId: cfg.textChannelId,
    savedOnly: false,
  };
}

module.exports = {
  setBotVoiceChannel,
  setBotTextChannel,
  confirmBotVoiceJoin,
  validateVoiceChannel,
  validateTextChannel,
};
