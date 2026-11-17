const fs = require('fs');
const path = require('path');
const botStore = require('../panel/botStore');
const botConfigStore = require('../panel/botConfigStore');
const profileStore = require('../panel/profileStore');
const { slaveProfileKey } = require('../panel/profileKeys');
const registry = require('../bridge/registry');
const MusicManager = require('../music/MusicManager');
const { slaveQueueKey, slaveRegistryKey } = require('../music/slaveQueueKey');

function removeSlavePlaylist(cfg) {
  const file = path.join(__dirname, '..', '..', 'data', 'playlists', `${slaveQueueKey(cfg)}.json`);
  if (!fs.existsSync(file)) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function removeSlaveFromDisk(guildId, name) {
  const key = String(name);
  const gid = String(guildId);
  const hadToken = botStore.remove(gid, key);
  botConfigStore.remove(key, gid);
  profileStore.clear(slaveProfileKey(gid, key));
  profileStore.clear(key, gid);
  removeSlavePlaylist({ name: key, guildId: gid });
  require('../util/runtimeSettings').setSlavePaused(gid, key, false);
  return hadToken;
}

async function disconnectSlaveIfRunning(guildId, name) {
  const key = String(name);
  const gid = String(guildId);
  const regKey = slaveRegistryKey({ name: key, guildId: gid });
  const entry = registry.state.slaves.get(regKey);
  if (!entry?.client) return false;

  const { teardownSlaveDeployment } = require('../bots/slave');
  await teardownSlaveDeployment(regKey);
  return true;
}

function listRunningSlaveNamesForGuild(guildId) {
  const gid = String(guildId);
  const names = new Set();
  for (const entry of registry.state.slaves.values()) {
    if (String(entry.cfg?.guildId) !== gid || !entry.client) continue;
    const name = entry.name ?? entry.cfg?.name;
    if (name) names.add(String(name));
  }
  return [...names];
}

/** Stop all running slaves for a guild — keeps bots.json assignments. */
async function disconnectAllGuildSlaves(guildId, tag = '[SUB]') {
  const gid = String(guildId);
  const names = listRunningSlaveNamesForGuild(gid);
  if (!names.length) return 0;

  let count = 0;
  for (const name of names) {
    if (await disconnectSlaveIfRunning(gid, name)) count += 1;
  }
  console.log(`${tag} Stopped ${count}/${names.length} slave(s) for guild ${gid}`);
  return count;
}

async function removeSlaveBot(name, guildId) {
  const gid = String(guildId);
  const disconnected = await disconnectSlaveIfRunning(gid, name);
  const removed = removeSlaveFromDisk(gid, name);
  return { removed, disconnected };
}

module.exports = {
  removeSlaveFromDisk,
  disconnectSlaveIfRunning,
  disconnectAllGuildSlaves,
  removeSlaveBot,
};
