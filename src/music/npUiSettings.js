const botConfigStore = require('../panel/botConfigStore');
const { parseSlaveQueueKey } = require('./slaveQueueKey');
const { guildIdFromQueueKey } = require('./queueKey');

const NP_UI_SIZES = ['compact', 'medium', 'large'];
const DEFAULT_NP_UI_SIZE = 'large';

function normalizeNpUiSize(value) {
  if (NP_UI_SIZES.includes(value)) return value;
  return DEFAULT_NP_UI_SIZE;
}

function botKeyFromQueueKey(queueKey) {
  const slave = parseSlaveQueueKey(queueKey);
  if (slave) return String(slave.name);
  return 'master';
}

function resolveGuildId(queueKey, guildId) {
  const slave = parseSlaveQueueKey(queueKey);
  if (slave?.guildId) return slave.guildId;
  if (guildId) return guildId;
  return guildIdFromQueueKey(queueKey);
}

function getNpUiSize(queueKey, guildId) {
  const gid = resolveGuildId(queueKey, guildId);
  if (!gid) return DEFAULT_NP_UI_SIZE;
  const botKey = botKeyFromQueueKey(queueKey);
  const cfg = botConfigStore.get(botKey, gid);
  return normalizeNpUiSize(cfg?.npUiSize);
}

function setNpUiSize(queueKey, guildId, size) {
  const gid = resolveGuildId(queueKey, guildId);
  if (!gid) throw new Error('guildId required');
  const normalized = normalizeNpUiSize(size);
  const botKey = botKeyFromQueueKey(queueKey);
  botConfigStore.merge(botKey, { npUiSize: normalized }, gid);
  return normalized;
}

function cycleNpUiSize(queueKey, guildId) {
  const current = getNpUiSize(queueKey, guildId);
  const idx = NP_UI_SIZES.indexOf(current);
  const next = NP_UI_SIZES[(idx + 1) % NP_UI_SIZES.length];
  return setNpUiSize(queueKey, guildId, next);
}

function npUiSizeNeedsControlsSubpage(size) {
  return size === 'medium';
}

module.exports = {
  NP_UI_SIZES,
  DEFAULT_NP_UI_SIZE,
  getNpUiSize,
  setNpUiSize,
  cycleNpUiSize,
  npUiSizeNeedsControlsSubpage,
};
