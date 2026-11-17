const fs = require('fs');
const path = require('path');
const guildChannelsStore = require('./guildChannelsStore');
const { resolveGuildId } = require('../config/channels');

const LEGACY_FILE = path.join(__dirname, '..', '..', 'data', 'bot-channels.json');

function get(botKey, guildId = resolveGuildId()) {
  if (!guildId) return null;
  if (String(botKey) === 'master') return guildChannelsStore.getMaster(guildId);
  return guildChannelsStore.getSlave(guildId, botKey);
}

function merge(botKey, patch, guildId = resolveGuildId()) {
  if (!guildId) throw new Error('GUILD_ID required for channel storage');
  return guildChannelsStore.mergeBot(guildId, botKey, patch);
}

function remove(botKey, guildId = resolveGuildId()) {
  if (!guildId || String(botKey) === 'master') return false;
  return guildChannelsStore.removeSlave(guildId, botKey);
}

module.exports = { get, merge, remove, LEGACY_FILE };
