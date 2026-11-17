const startSlave = require('../bots/slave');
const { t } = require('../i18n/context');
const botStore = require('../panel/botStore');
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const { slaveRegistryKey } = require('../music/slaveQueueKey');
const { mergeSlaveChannelCfg, resolveSlaveGuildId } = require('./channels');

function buildCfgForName(name, guildId) {
  const stored = botStore.get(guildId, name) || botStore.getByName(name);
  if (!stored?.token) throw new Error(t('err.botNotRegistered', { name }));
  const idx = parseInt(name, 10);
  return mergeSlaveChannelCfg({
    name: String(name),
    token: stored.token,
    guildId: stored.guildId || guildId || (Number.isFinite(idx) ? resolveSlaveGuildId(idx) : null),
    channelId: null,
    textChannelId: null,
  });
}

async function ensureSlaveRunning(name, guildId) {
  const key = String(name);
  const gid = String(guildId);

  if (!subscriptionStore.guildHasSlaves(gid)) {
    throw new Error(t('err.slavesOff'));
  }

  const runningOnGuild = [...registry.state.slaves.values()]
    .filter(e => String(e.cfg?.guildId) === gid).length;
  const max = subscriptionStore.getMaxSlavesForGuild(gid);

  const cfgPreview = buildCfgForName(key, gid);
  const regKey = slaveRegistryKey(cfgPreview);
  const entry = registry.state.slaves.get(regKey);

  if (entry?.client) {
    const cfg = mergeSlaveChannelCfg(entry.cfg);
    entry.cfg.channelId = cfg.channelId;
    entry.cfg.textChannelId = cfg.textChannelId;
    entry.voice?.setChannelId(cfg.channelId);
    entry.reconnect?.();
    return { name: key, action: 'reconnect' };
  }

  if (runningOnGuild >= max) {
    throw new Error(t('err.slaveLimit', { max }));
  }

  const cfg = buildCfgForName(key, gid);
  if (!cfg.channelId) {
    throw new Error(t('err.assignRoomFirst'));
  }

  const client = await startSlave(cfg);
  await client.whenVoiceReady;
  return { name: key, action: 'started' };
}

module.exports = { ensureSlaveRunning, buildCfgForName };
