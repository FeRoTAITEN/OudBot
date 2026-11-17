const subsAdminStore = require('./subsAdminStore');

/** Admin server: the one picked in the dashboard, else ADMIN_GUILD_ID. */
function getAdminGuildId() {
  return subsAdminStore.getAdminGuildId() || process.env.ADMIN_GUILD_ID?.trim() || null;
}

function adminGuildSource() {
  if (subsAdminStore.getAdminGuildId()) return 'web';
  return process.env.ADMIN_GUILD_ID?.trim() ? 'env' : null;
}

function getAdminRoleIds() {
  return subsAdminStore.listRoleIds();
}

function getAdminRoleNames() {
  return subsAdminStore.listRoleNames();
}

function getSubsAdminUserIds() {
  return subsAdminStore.listUserIds();
}

function getSubsAuditChannelId() {
  return process.env.SUBS_AUDIT_CHANNEL_ID?.trim() || null;
}

function isSubsAdminConfigured() {
  return Boolean(getAdminGuildId());
}

module.exports = {
  getAdminGuildId,
  adminGuildSource,
  getAdminRoleIds,
  getAdminRoleNames,
  getSubsAdminUserIds,
  getSubsAuditChannelId,
  isSubsAdminConfigured,
};
