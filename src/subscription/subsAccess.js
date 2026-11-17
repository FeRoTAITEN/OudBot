const { PermissionFlagsBits } = require('discord.js');
const {
  getAdminGuildId,
  getAdminRoleIds,
  getAdminRoleNames,
  getSubsAdminUserIds,
} = require('./adminConfig');

function isSubsAdminGuild(guildId) {
  const adminId = getAdminGuildId();
  return Boolean(adminId && String(guildId) === adminId);
}

function isSubsAdmin(member) {
  if (!member?.guild?.id || !member.user) return false;
  if (!isSubsAdminGuild(member.guild.id)) return false;

  const userIds = getSubsAdminUserIds();
  if (userIds.includes(member.user.id)) return true;

  const roleIds = getAdminRoleIds();
  // Allow user ID in ADMIN_ROLE_IDS (common mix-up with role ID)
  if (roleIds.includes(member.user.id)) return true;

  if (roleIds.length && member.roles?.cache?.some(r => roleIds.includes(r.id))) {
    return true;
  }

  const roleNames = getAdminRoleNames();
  if (roleNames.length && member.roles?.cache?.some(r => roleNames.includes(r.name.toLowerCase()))) {
    return true;
  }

  if (!roleIds.length && !roleNames.length && !userIds.length) {
    return member.permissions?.has(PermissionFlagsBits.Administrator) ?? false;
  }

  return false;
}

module.exports = { isSubsAdminGuild, isSubsAdmin };
