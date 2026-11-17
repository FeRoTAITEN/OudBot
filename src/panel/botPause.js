const registry = require('../bridge/registry');
const { t } = require('../i18n/context');
const { getVoiceLockerForBotKey } = require('./botProfile');
const { botDisplayLabel } = require('./roomLabel');
const globalVoice = require('../bots/globalVoice');

function botLabel(guild, botKey) {
  return botKey === 'master' ? t('common.master') : botDisplayLabel(guild, botKey);
}

function isMasterGuildPaused(guildId) {
  return globalVoice.isGuildVoicePaused(guildId);
}

function isBotPaused(botKey, guildId = null) {
  if (botKey === 'master' && guildId) {
    return isMasterGuildPaused(guildId);
  }
  const locker = getVoiceLockerForBotKey(botKey, guildId);
  return Boolean(locker?.isPaused?.());
}

async function toggleMasterGuildPause(guild) {
  const label = botLabel(guild, 'master');
  const client = registry.state.master?.client;
  if (!client) throw new Error(t('err.masterNotConnected'));

  if (globalVoice.isGuildVoicePaused(guild.id)) {
    await globalVoice.resumeGuildVoice(client, guild.id, '[MASTER]');
    return { label, paused: false };
  }

  globalVoice.pauseGuildVoice(guild.id, '[MASTER]');
  return { label, paused: true };
}

async function toggleBotPause(botKey, guild = null) {
  const key = String(botKey);

  if (key === 'master' && guild?.id) {
    return toggleMasterGuildPause(guild);
  }

  const locker = getVoiceLockerForBotKey(key, guild?.id);
  if (!locker) throw new Error(t('err.botNotReady'));

  const label = guild ? botLabel(guild, key) : key;

  if (locker.isPaused()) {
    await locker.resume();
    return { label, paused: false };
  }

  locker.pause();
  return { label, paused: true };
}

async function pauseAllSlaves(guild = null) {
  const results = [];
  if (guild?.id && registry.state.master?.client && !globalVoice.isGuildVoicePaused(guild.id)) {
    globalVoice.pauseGuildVoice(guild.id, '[MASTER]');
    results.push(botLabel(guild, 'master'));
  }
  for (const snap of registry.getSlaveSnapshots(guild?.id)) {
    const locker = registry.getSlaveEntry(snap.guildId, snap.name)?.voice;
    if (!locker || locker.isPaused()) continue;
    locker.pause();
    results.push(guild ? botLabel(guild, snap.name) : snap.name);
  }
  return results;
}

async function resumeAllSlaves(guild = null) {
  const results = [];
  if (guild?.id && registry.state.master?.client && globalVoice.isGuildVoicePaused(guild.id)) {
    await globalVoice.resumeGuildVoice(registry.state.master.client, guild.id, '[MASTER]');
    results.push(botLabel(guild, 'master'));
  }
  for (const snap of registry.getSlaveSnapshots(guild?.id)) {
    const locker = registry.getSlaveEntry(snap.guildId, snap.name)?.voice;
    if (!locker?.isPaused()) continue;
    await locker.resume();
    results.push(guild ? botLabel(guild, snap.name) : snap.name);
  }
  return results;
}

module.exports = {
  isBotPaused,
  toggleBotPause,
  pauseAllSlaves,
  resumeAllSlaves,
};
