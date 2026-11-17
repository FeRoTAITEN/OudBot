function queueKeyForGuild(guildId) {
  return `guild:${String(guildId)}`;
}

function guildIdFromQueueKey(queueKey) {
  const m = String(queueKey).match(/^guild:(\d+)$/);
  return m?.[1] ?? null;
}

/** Accept legacy bridge embeds (`music:master:…`) on global guild queues. */
function musicQueueKeyMatches(parsedKey, expectedKey, guildId) {
  if (parsedKey === expectedKey) return true;
  if (parsedKey === 'master' && expectedKey === queueKeyForGuild(guildId)) return true;
  return false;
}

module.exports = {
  queueKeyForGuild,
  guildIdFromQueueKey,
  musicQueueKeyMatches,
};
