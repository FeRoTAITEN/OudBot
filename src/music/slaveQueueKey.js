function slaveQueueKey(cfg) {
  const name = String(cfg.name);
  const guildId = cfg.guildId ? String(cfg.guildId) : null;
  return guildId ? `slave-${guildId}-${name}` : `slave-${name}`;
}

function slaveRegistryKey(cfg) {
  const name = String(cfg.name);
  const guildId = cfg.guildId ? String(cfg.guildId) : null;
  return guildId ? `${guildId}:${name}` : name;
}

function parseSlaveQueueKey(queueKey) {
  const str = String(queueKey);
  const withGuild = str.match(/^slave-(\d+)-(\d+)$/);
  if (withGuild) return { guildId: withGuild[1], name: withGuild[2] };
  const legacy = str.match(/^slave-(\d+)$/);
  if (legacy) return { guildId: null, name: legacy[1] };
  return null;
}

module.exports = { slaveQueueKey, slaveRegistryKey, parseSlaveQueueKey };
