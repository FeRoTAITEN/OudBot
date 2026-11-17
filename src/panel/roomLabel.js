const registry = require('../bridge/registry');
const profileStore = require('./profileStore');
const { t } = require('../i18n/context');
const { slaveRegistryKey } = require('../music/slaveQueueKey');

const SLAVE_THEME_COLORS = [0x5865f2, 0xeb459e, 0x57f287, 0xfee75c, 0xed4245, 0x9b59b6, 0xe67e22];
const SLAVE_THEME_EMOJIS = ['🎧', '🎤', '🎸', '🎹', '🎺', '🥁', '🎻'];
const MASTER_DEFAULT_COLOR = 0xfee75c;

function themeForSlave(name, guildId = null) {
  const n = String(name);
  const idx = Math.max(0, (parseInt(n, 10) || 1) - 1);
  const saved = profileStore.get(n, guildId);
  return {
    color: saved?.bannerColor ?? SLAVE_THEME_COLORS[idx % SLAVE_THEME_COLORS.length],
    emoji: SLAVE_THEME_EMOJIS[idx % SLAVE_THEME_EMOJIS.length],
    label: `${t('common.slave')} #${n}`,
  };
}

function themeForMaster() {
  const saved = profileStore.get('master');
  return {
    color: saved?.bannerColor ?? MASTER_DEFAULT_COLOR,
    emoji: '📢',
    label: t('common.master'),
  };
}

function parseBotUsername(tag) {
  if (!tag || tag === '— (not running)' || tag === '—') return null;
  const hash = tag.indexOf('#');
  const name = hash > 0 ? tag.slice(0, hash) : tag.trim();
  return name || null;
}

function voiceChannelName(guild, channelId) {
  if (!guild || !channelId) return null;
  return guild.channels.cache.get(channelId)?.name?.trim() || null;
}

function slaveBotName(slave) {
  return parseBotUsername(slave?.tag) || (slave?.name ? `#${slave.name}` : null);
}

function composeBotRoomLabel(botName, roomName, fallback) {
  if (botName && roomName) return `${botName} · ${roomName}`;
  if (botName) return botName;
  if (roomName) return roomName;
  return fallback;
}

/** True for a room bot the server added with its own token (not one of the owner's pool bots). */
function isPrivateSlave(guildId, name) {
  if (!guildId || name == null) return false;
  const { listPoolBots, labelForToken } = require('../config/slavePoolStore');
  if (!listPoolBots().length) return false;
  const token = registry.state.slaves.get(slaveRegistryKey({ guildId, name }))?.cfg?.token;
  return Boolean(token) && !labelForToken(token);
}

/** Bot username + voice room name when known (panel labels, menus). */
function roomLabel(guild, slave) {
  const th = themeForSlave(slave?.name ?? slave);
  const bot = slaveBotName(slave);
  const room = voiceChannelName(guild, slave?.channelId);
  const mark = isPrivateSlave(guild?.id, slave?.name) ? ` ${t('common.privateTag')}` : '';
  const label = composeBotRoomLabel(bot, room, th.label);
  return `${label.slice(0, 100 - mark.length)}${mark}`;
}

function slaveRoomLabel(guild, slaveName) {
  const s = registry.getSlaveSnapshots(guild?.id).find(x => x.name === String(slaveName));
  return roomLabel(guild, s || { name: slaveName });
}

function getPanelGuild(client, preferredGuildId = null) {
  if (!client) return null;
  if (preferredGuildId) {
    return client.guilds.cache.get(String(preferredGuildId)) ?? null;
  }
  return client.guilds.cache.first() ?? null;
}

function botDisplayLabel(guild, botKey) {
  if (botKey === 'master') {
    const master = registry.getMasterSnapshot(guild?.id);
    const bot = parseBotUsername(master?.tag) || t('common.master');
    const room = voiceChannelName(guild, master?.channelId);
    return composeBotRoomLabel(bot, room, t('common.master')).slice(0, 100);
  }
  return slaveRoomLabel(guild, botKey);
}

function masterChatSelectLabel(guild) {
  const master = registry.getMasterSnapshot(guild?.id);
  const bot = parseBotUsername(master?.tag) || t('common.master');
  const room = voiceChannelName(guild, master?.textChannelId);
  return composeBotRoomLabel(bot, room, t('common.master')).slice(0, 100);
}

module.exports = {
  themeForSlave,
  themeForMaster,
  roomLabel,
  slaveRoomLabel,
  getPanelGuild,
  botDisplayLabel,
  masterChatSelectLabel,
  isPrivateSlave,
};
