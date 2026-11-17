const botConfigStore = require('./botConfigStore');
const { t } = require('../i18n/context');

function getAllowedRoleIds(botKey, guildId) {
  const ids = botConfigStore.get(botKey, guildId)?.allowedRoleIds;
  if (!Array.isArray(ids) || !ids.length) return null;
  return ids.filter(Boolean);
}

function saveAllowedChatRoles(botKey, roleIds, guildId) {
  const key = String(botKey);
  if (!roleIds?.length) {
    botConfigStore.merge(key, { allowedRoleIds: null }, guildId);
    return { botKey: key, count: 0 };
  }
  botConfigStore.merge(key, { allowedRoleIds: [...roleIds] }, guildId);
  return { botKey: key, count: roleIds.length };
}

function saveAllowedChatRolesBulk(roleIds, guildId) {
  const botStore = require('./botStore');
  const results = [];
  for (const { name } of botStore.listSlaves(guildId)) {
    results.push(saveAllowedChatRoles(name, roleIds, guildId));
  }
  return results;
}

function formatAllowedChatRoles(guild, botKey) {
  const ids = getAllowedRoleIds(botKey, guild?.id);
  if (!ids) return t('chat.everyone');
  if (!guild) return t('chat.roles', { count: ids.length });
  const names = ids
    .map(id => guild.roles.cache.get(id)?.name || id)
    .slice(0, 8);
  const extra = ids.length > names.length ? ` +${ids.length - names.length}` : '';
  return names.map(n => `\`${n}\``).join(', ') + extra;
}

module.exports = {
  getAllowedRoleIds,
  saveAllowedChatRoles,
  saveAllowedChatRolesBulk,
  formatAllowedChatRoles,
};
