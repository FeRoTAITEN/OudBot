// identity.js – who may use the dashboard and with which role. Re-checked live (see server.js refreshIdentity).
// owner = WEB_OWNER_IDS / CONTROL_USER_IDS (full); subsadmin = subscription admins (servers + subscriptions only);
// manager = T57 web managers (all servers, subscriptions, broadcast, bots, logs; not security/owner powers);
// guild = Manage Server / Administrator on a subscribed server (that server only); member = player only.
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const subsAdminStore = require('../subscription/subsAdminStore');
const managerStore = require('./managerStore');
const ownerStore = require('./ownerStore');
const { getSubsAdminUserIds, getAdminGuildId } = require('../subscription/adminConfig');
const { isSubsAdmin } = require('../subscription/subsAccess');

function idList(raw) {
  return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** T82: owners from .env only (they add / remove the other owners). */
function rootOwnerIds() {
  return new Set([...idList(process.env.WEB_OWNER_IDS), ...idList(process.env.CONTROL_USER_IDS)]);
}

/** Every owner: .env plus the ones added from the dashboard (T82). */
function ownerIds() {
  const ids = rootOwnerIds();
  for (const id of ownerStore.listUserIds()) ids.add(String(id));
  return ids;
}

/** Owner who may manage owners: an .env owner, or the password login. */
function isRootOwner(identity) {
  return identity?.role === 'owner' && (!identity.userId || rootOwnerIds().has(String(identity.userId)));
}

function subsAdminIds() {
  const ids = new Set();
  for (const id of getSubsAdminUserIds() || []) ids.add(String(id));
  for (const id of subsAdminStore.listUserIds() || []) ids.add(String(id));
  return ids;
}

function avatarOf(user) {
  try { return user?.displayAvatarURL?.({ size: 64 }) || null; } catch { return null; }
}

function baseIdentity(user, role, guilds = []) {
  return {
    userId: String(user.id),
    name: user.globalName || user.username || String(user.id),
    avatar: avatarOf(user),
    role,
    guilds,
  };
}

function ownerIdentity(user) {
  return baseIdentity(user, 'owner');
}

function isManagerId(id) {
  return !ownerIds().has(String(id)) && managerStore.has(id);
}

/** T78: a manager limited to some servers acts as a server admin there (no global pages). */
function managerIdentity(user) {
  const scope = managerStore.scopeOf(user.id).filter(g => subscriptionStore.isGuildAllowed(g));
  if (managerStore.scopeOf(user.id).length) return { ...baseIdentity(user, 'guild', scope), scopedManager: true };
  return baseIdentity(user, 'manager');
}

/** From a guild member who typed the dashboard command. */
function fromMember(member) {
  if (!member?.user) return null;
  const user = member.user;
  const id = String(user.id);
  if (ownerIds().has(id)) return ownerIdentity(user);
  if (isManagerId(id)) return managerIdentity(user);
  const gid = member.guild?.id;
  const admin = Boolean(gid && subscriptionStore.isGuildAllowed(gid) && registry.canUsePanel(member));
  let subs = subsAdminIds().has(id);
  try { subs = subs || isSubsAdmin(member); } catch { /* ignore */ }
  if (subs) return baseIdentity(user, 'subsadmin', admin ? [String(gid)] : []);
  if (admin) return { ...baseIdentity(user, 'guild', [String(gid)]), name: member.displayName || user.globalName || user.username };
  return null;
}

async function memberIn(guild, id) {
  return guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
}

/** Subscription admin by id list, or by role/permission in the admin server. */
async function isSubsAdminUser(client, id) {
  if (subsAdminIds().has(id)) return true;
  const guild = client?.guilds?.cache?.get(String(getAdminGuildId() || ''));
  if (!guild) return false;
  const member = await memberIn(guild, id);
  try { return Boolean(member && isSubsAdmin(member)); } catch { return false; }
}

/** From a Discord user id: owner, subscription admin, or manager of subscribed guilds; null otherwise. */
async function fromUserId(client, userId) {
  const id = String(userId || '').trim();
  if (!/^\d{17,20}$/.test(id) || !client) return null;
  const user = await client.users.fetch(id).catch(() => null);
  if (!user || user.bot) return null;
  if (ownerIds().has(id)) return ownerIdentity(user);
  if (isManagerId(id)) return managerIdentity(user);

  const guilds = [];
  for (const gid of subscriptionStore.listGuildIds()) {
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;
    const member = await memberIn(guild, id);
    if (member && registry.canUsePanel(member)) guilds.push(String(gid));
  }
  if (await isSubsAdminUser(client, id)) return baseIdentity(user, 'subsadmin', guilds);
  if (!guilds.length) return null;
  return baseIdentity(user, 'guild', guilds);
}

/** Full access to one server (music, rooms, perms). */
function canAccessGuild(identity, guildId) {
  if (!identity) return false;
  if (isStaff(identity)) return true;
  return Boolean(identity.guilds?.includes(String(guildId)) && subscriptionStore.isGuildAllowed(guildId));
}

/** May view and edit subscriptions (owner, subscription admins). */
function canManageSubs(identity) {
  return isStaff(identity) || identity?.role === 'subsadmin';
}

/** Owner or manager: every server, overview, bots, logs, broadcast. */
function isStaff(identity) {
  return identity?.role === 'owner' || identity?.role === 'manager';
}

/** T81: owner or manager of this server by Discord id (a scoped manager: his servers only). */
function isStaffFor(userId, guildId) {
  const id = String(userId || '');
  if (ownerIds().has(id)) return true;
  if (!isManagerId(id)) return false;
  const scope = managerStore.scopeOf(id);
  return !scope.length || scope.includes(String(guildId));
}

/** T81: owner, manager, or a scoped manager on one of his servers: sees every section there. */
function serverStaff(identity, guildId) {
  return isStaff(identity) || Boolean(identity?.scopedManager && identity.guilds?.includes(String(guildId)));
}

/** T81: show / read / hide of one section for this viewer on this server (adminView.js). */
function sectionLevel(identity, guildId, section) {
  if (serverStaff(identity, guildId)) return 'show';
  return require('./adminView').levelOf(guildId, section);
}

/** Same for a Discord member (panel buttons, music controls). */
function memberSectionLevel(member, guildId, section) {
  if (member && isStaffFor(member.id, guildId)) return 'show';
  return require('./adminView').levelOf(guildId, section);
}

module.exports = {
  ownerIds, rootOwnerIds, isRootOwner, subsAdminIds, fromMember, fromUserId, canAccessGuild, canManageSubs, ownerIdentity, isStaff, isManagerId,
  isStaffFor, serverStaff, sectionLevel, memberSectionLevel,
};
