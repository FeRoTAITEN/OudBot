const { getGuildMasterChannels } = require('../config/channels');
const { isGuildBridgeRuntime } = require('../config/mode');

function getMasterVoiceChannelId(guildId) {
  if (!guildId) return null;
  return getGuildMasterChannels(guildId).voiceChannelId || null;
}

/** Slave assigned to the same voice channel as Master (staging / duplication risk). */
function isSlaveCollidingWithMaster(slaveChannelId, guildId) {
  if (!guildId || !isGuildBridgeRuntime(guildId)) return false;
  const masterCh = getMasterVoiceChannelId(guildId);
  return Boolean(masterCh && slaveChannelId && slaveChannelId === masterCh);
}

/** Any slave is still assigned to Master's voice channel in this guild. */
function isMasterRoomShared(guildId) {
  if (!guildId || !isGuildBridgeRuntime(guildId)) return false;
  const masterCh = getMasterVoiceChannelId(guildId);
  if (!masterCh) return false;
  const { state } = require('./registry');
  for (const entry of state.slaves.values()) {
    if (entry.cfg?.guildId === String(guildId) && entry.cfg?.channelId === masterCh) return true;
  }
  return false;
}

/** Bridge capture + relay blocked for this slave channel. */
function isSlaveBridgeBlocked(slaveChannelId, guildId) {
  return isSlaveCollidingWithMaster(slaveChannelId, guildId);
}

module.exports = {
  getMasterVoiceChannelId,
  isSlaveCollidingWithMaster,
  isMasterRoomShared,
  isSlaveBridgeBlocked,
};
