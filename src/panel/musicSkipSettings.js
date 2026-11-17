const botConfigStore = require('./botConfigStore');
const { parseSlaveQueueKey } = require('../music/slaveQueueKey');
const { guildIdFromQueueKey } = require('../music/queueKey');

const DEFAULT_VOTE_TO_SKIP = true;

function normalizeVoteToSkip(value) {
  if (value === false || value === 'false' || value === 0) return false;
  return DEFAULT_VOTE_TO_SKIP;
}

function getGuildDefaultVoteToSkip(guildId) {
  if (!guildId) return DEFAULT_VOTE_TO_SKIP;
  const cfg = botConfigStore.get('master', guildId);
  return normalizeVoteToSkip(cfg?.voteToSkip);
}

function getSlaveVoteToSkipOverride(slaveName, guildId) {
  if (!guildId) return null;
  const cfg = botConfigStore.get(String(slaveName), guildId);
  if (!cfg || !Object.prototype.hasOwnProperty.call(cfg, 'voteToSkip')) return null;
  return normalizeVoteToSkip(cfg.voteToSkip);
}

function getEffectiveVoteToSkip(botKey, guildId) {
  if (String(botKey) === 'master') return getGuildDefaultVoteToSkip(guildId);
  const override = getSlaveVoteToSkipOverride(botKey, guildId);
  if (override !== null) return override;
  return getGuildDefaultVoteToSkip(guildId);
}

/** Panel / display — master key = guild default, slave = effective room setting */
function getVoteToSkip(botKey, guildId) {
  if (String(botKey) === 'master') return getGuildDefaultVoteToSkip(guildId);
  return getEffectiveVoteToSkip(botKey, guildId);
}

function isVoteToSkipEnabled(queueKey, guildId) {
  const slave = parseSlaveQueueKey(queueKey);
  if (slave) {
    const gid = slave.guildId || guildId;
    if (gid) return getEffectiveVoteToSkip(slave.name, gid);
  }
  const gid = guildId || guildIdFromQueueKey(queueKey);
  if (gid) return getGuildDefaultVoteToSkip(gid);
  return DEFAULT_VOTE_TO_SKIP;
}

function setGuildDefaultVoteToSkip(guildId, enabled) {
  if (!guildId) throw new Error('guildId required');
  botConfigStore.merge('master', { voteToSkip: Boolean(enabled) }, guildId);
  return Boolean(enabled);
}

function setSlaveVoteToSkip(slaveName, guildId, enabled) {
  if (!guildId) throw new Error('guildId required');
  botConfigStore.merge(String(slaveName), { voteToSkip: Boolean(enabled) }, guildId);
  return Boolean(enabled);
}

function clearSlaveVoteToSkipOverride(slaveName, guildId) {
  if (!guildId) throw new Error('guildId required');
  botConfigStore.merge(String(slaveName), { voteToSkip: null }, guildId);
}

function toggleGuildDefaultVoteToSkip(guildId) {
  const next = !getGuildDefaultVoteToSkip(guildId);
  setGuildDefaultVoteToSkip(guildId, next);
  return next;
}

function setVoteToSkip(botKey, guildId, enabled) {
  if (String(botKey) === 'master') return setGuildDefaultVoteToSkip(guildId, enabled);
  return setSlaveVoteToSkip(botKey, guildId, enabled);
}

function toggleVoteToSkip(botKey, guildId) {
  if (String(botKey) === 'master') return toggleGuildDefaultVoteToSkip(guildId);
  const next = !getEffectiveVoteToSkip(botKey, guildId);
  setSlaveVoteToSkip(botKey, guildId, next);
  return next;
}

module.exports = {
  DEFAULT_VOTE_TO_SKIP,
  getGuildDefaultVoteToSkip,
  getSlaveVoteToSkipOverride,
  getEffectiveVoteToSkip,
  getVoteToSkip,
  isVoteToSkipEnabled,
  setGuildDefaultVoteToSkip,
  setSlaveVoteToSkip,
  clearSlaveVoteToSkipOverride,
  setVoteToSkip,
  toggleGuildDefaultVoteToSkip,
  toggleVoteToSkip,
};
