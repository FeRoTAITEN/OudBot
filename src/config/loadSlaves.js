const botStore = require('../panel/botStore');
const { resolveSlaveGuildId } = require('./channels');

function buildSlaveCfg(entry) {
  const name = String(entry.name);
  const idx = parseInt(name, 10);
  return {
    name,
    token: entry.token,
    guildId: entry.guildId || (Number.isFinite(idx) ? resolveSlaveGuildId(idx) : null),
    channelId: null,
    textChannelId: null,
  };
}

function loadSlaveConfigs() {
  return botStore.listSlaves().map(entry => buildSlaveCfg(entry));
}

module.exports = { loadSlaveConfigs };
