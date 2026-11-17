const startSlave = require('../bots/slave');
const { t } = require('../i18n/context');
const botStore = require('../panel/botStore');
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const { slaveRegistryKey } = require('../music/slaveQueueKey');
const { mergeSlaveChannelCfg, resolveSlaveGuildId } = require('./channels');

function isTokenRunning(token) {
  const wanted = String(token).trim();
  for (const [, entry] of registry.state.slaves) {
    if (entry.client?.token === wanted) return true;
  }
  return false;
}

function buildSlaveCfg(name, token, guildId) {
  const idx = parseInt(name, 10);
  return mergeSlaveChannelCfg({
    name: String(name),
    token: String(token).trim(),
    guildId: guildId || (Number.isFinite(idx) ? resolveSlaveGuildId(idx) : null),
    channelId: null,
    textChannelId: null,
  });
}

async function addSlaveBot({ token, guildId = null }) {
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error(t('err.tokenRequired'));
  const guild = String(guildId ?? '').trim();
  if (!guild) throw new Error(t('err.guildRequired'));

  if (!subscriptionStore.guildHasSlaves(guild)) {
    throw new Error(t('err.slavesOff'));
  }

  const existing = botStore.listSlaves(guild);
  const max = subscriptionStore.getMaxSlavesForGuild(guild);
  if (existing.length >= max) {
    throw new Error(t('err.slaveLimit', { max }));
  }
  if (existing.some(s => s.token === trimmed)) {
    throw new Error(t('err.botAlreadyHere'));
  }

  const name = botStore.nextSlaveName(guild);
  botStore.set(guild, name, { token: trimmed });

  if (isTokenRunning(trimmed)) {
    return { name, guildId: guild, started: false, needsRoom: true, sharedToken: true };
  }

  const cfg = buildSlaveCfg(name, trimmed, guild);
  const regKey = slaveRegistryKey(cfg);
  if (!cfg.channelId) {
    return { name, guildId: guild, started: false, needsRoom: true };
  }

  if (registry.state.slaves.has(regKey)) {
    return { name, guildId: guild, started: true, needsRoom: false };
  }

  try {
    const slave = await startSlave(cfg);
    await slave.whenVoiceReady;
    const hasText = Boolean(cfg.textChannelId);
    return { name, guildId: guild, started: true, needsRoom: !hasText };
  } catch (err) {
    botStore.remove(guild, name);
    throw err;
  }
}

module.exports = { addSlaveBot };
