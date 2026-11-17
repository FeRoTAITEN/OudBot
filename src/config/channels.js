// channels.js – resolve voice + text channel ids from store / bootstrap / .env

const { ChannelType } = require('discord.js');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { resolveTextForBot, resolveTextChannelId } = require('./channelResolve');

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
]);

function isTextChannelValid(guild, channelId) {
  if (!guild || !channelId) return false;
  const ch = guild.channels.cache.get(channelId);
  return ch != null && TEXT_CHANNEL_TYPES.has(ch.type);
}

/** Optional default guild from .env (bootstrap / local dev). */
function resolveGuildId() {
  return process.env.GUILD_ID?.trim()
    || process.env.MASTER_GUILD_ID?.trim()
    || process.env.SLAVE_GUILD_ID?.trim()
    || null;
}

function getGuildMasterChannels(guildId) {
  if (!guildId) {
    return {
      guildId: null,
      voiceChannelId: null,
      textChannelId: null,
    };
  }
  const voiceEnv = process.env.MASTER_VOICE_CHANNEL_ID?.trim() || null;
  const stored = guildChannelsStore.getMaster(guildId);
  const voiceChannelId = stored?.voiceChannelId?.trim() || voiceEnv;
  const envText = resolveTextChannelId(
    process.env.MASTER_TEXT_CHANNEL_ID,
    voiceEnv,
  );
  return {
    guildId: String(guildId),
    voiceChannelId,
    textChannelId: resolveTextForBot(stored, voiceChannelId, envText),
  };
}

function getMasterChannels(guildId = resolveGuildId()) {
  return getGuildMasterChannels(guildId);
}

/** Apply saved voice/text overrides from guildChannelsStore. */
function mergeSlaveChannelCfg(cfg) {
  const guildId = cfg.guildId || resolveGuildId();
  const stored = guildId ? guildChannelsStore.getSlave(guildId, cfg.name) : null;
  let voiceChannelId = stored?.voiceChannelId?.trim() || cfg.channelId;
  if (!voiceChannelId && guildId) {
    voiceChannelId = getGuildMasterChannels(guildId).voiceChannelId;
  }
  const masterVoice = guildId ? getGuildMasterChannels(guildId).voiceChannelId?.trim() : null;
  const onMasterFallback = masterVoice && voiceChannelId === masterVoice;
  const textChannelId = onMasterFallback
    ? null
    : resolveTextForBot(stored, voiceChannelId, cfg.textChannelId);
  return {
    ...cfg,
    channelId: voiceChannelId,
    textChannelId,
  };
}

function resolveSlaveGuildId(_index) {
  return resolveGuildId() || null;
}

module.exports = {
  resolveGuildId,
  resolveSlaveGuildId,
  getMasterChannels,
  getGuildMasterChannels,
  mergeSlaveChannelCfg,
  isTextChannelValid,
};
