const subscriptionStore = require('../subscription/subscriptionStore');

function guildBridgeEnabled(guild) {
  if (!guild?.id) return false;
  return subscriptionStore.getGuildFeatures(guild.id).bridge;
}

function guildSlavesEnabled(guild) {
  if (!guild?.id) return false;
  return subscriptionStore.getGuildFeatures(guild.id).slaves;
}

function guildSlaveProfileEditEnabled(guild) {
  if (!guild?.id) return true;
  return subscriptionStore.getGuildFeatures(guild.id).editSlaveProfile;
}

module.exports = {
  guildBridgeEnabled,
  guildSlavesEnabled,
  guildSlaveProfileEditEnabled,
};
