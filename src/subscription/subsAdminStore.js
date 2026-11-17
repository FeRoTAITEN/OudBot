const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic, watchJson, isUnreadable } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'subs-admins.json');

let cache = { userIds: [], roleIds: [], roleNames: [] };
let loaded = false;
let lastSerialized = '';

function parseCsvEnv(name) {
  return (process.env[name] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeRoleNames(names) {
  return [...new Set(
    (Array.isArray(names) ? names : [])
      .map(s => String(s).trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeIds(ids) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map(s => String(s).trim())
      .filter(Boolean),
  )];
}

function defaultData() {
  return { userIds: [], roleIds: [], roleNames: [], adminGuildId: null };
}

function readFile() {
  const res = readJson(FILE);
  if (!res.exists) return defaultData();
  if (!res.ok) return null;
  const raw = res.data;
  if (!raw || typeof raw !== 'object') return defaultData();
  return {
    userIds: normalizeIds(raw.userIds),
    roleIds: normalizeIds(raw.roleIds),
    roleNames: normalizeRoleNames(raw.roleNames),
    // T65: admin server picked in the dashboard (overrides ADMIN_GUILD_ID).
    adminGuildId: /^\d{17,20}$/.test(String(raw.adminGuildId || '')) ? String(raw.adminGuildId) : null,
  };
}

function reload() {
  const raw = readFile();
  if (raw == null) return false;
  const serialized = JSON.stringify(raw);
  if (serialized === lastSerialized && loaded) return true;
  lastSerialized = serialized;
  cache = raw;
  loaded = true;
  return true;
}

function ensureLoaded() {
  if (!loaded) reload();
}

function writeCache() {
  if (!loaded && isUnreadable(FILE)) throw new Error('subs-admins.json is unreadable — refusing to overwrite it (fix or restore the file, then retry)');
  ensureLoaded();
  writeJsonAtomic(FILE, cache);
  lastSerialized = JSON.stringify(cache);
}

function listUserIds() {
  ensureLoaded();
  return [...cache.userIds];
}

function listRoleIds() {
  ensureLoaded();
  return [...cache.roleIds];
}

function listRoleNames() {
  ensureLoaded();
  return [...cache.roleNames];
}

function addUser(userId) {
  ensureLoaded();
  const id = String(userId ?? '').trim();
  if (!id) return false;
  if (cache.userIds.includes(id)) return false;
  cache.userIds.push(id);
  writeCache();
  return true;
}

function removeUser(userId) {
  ensureLoaded();
  const id = String(userId ?? '').trim();
  const before = cache.userIds.length;
  cache.userIds = cache.userIds.filter(u => u !== id);
  if (cache.userIds.length === before) return false;
  writeCache();
  return true;
}

function addRole(roleId) {
  ensureLoaded();
  const id = String(roleId ?? '').trim();
  if (!id) return false;
  if (cache.roleIds.includes(id)) return false;
  cache.roleIds.push(id);
  writeCache();
  return true;
}

function removeRole(roleId) {
  ensureLoaded();
  const id = String(roleId ?? '').trim();
  const before = cache.roleIds.length;
  cache.roleIds = cache.roleIds.filter(r => r !== id);
  if (cache.roleIds.length === before) return false;
  writeCache();
  return true;
}

function addRoleName(name) {
  ensureLoaded();
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return false;
  if (cache.roleNames.includes(key)) return false;
  cache.roleNames.push(key);
  writeCache();
  return true;
}

function removeRoleName(name) {
  ensureLoaded();
  const key = String(name ?? '').trim().toLowerCase();
  const before = cache.roleNames.length;
  cache.roleNames = cache.roleNames.filter(r => r !== key);
  if (cache.roleNames.length === before) return false;
  writeCache();
  return true;
}

function removeEntry(key) {
  const raw = String(key ?? '');
  if (raw.startsWith('user:')) return removeUser(raw.slice(5));
  if (raw.startsWith('role:')) return removeRole(raw.slice(5));
  if (raw.startsWith('rolename:')) return removeRoleName(raw.slice(9));
  return false;
}

function seedFromEnv() {
  if (fs.existsSync(FILE)) {
    reload();
    return;
  }
  const data = {
    userIds: parseCsvEnv('SUBS_ADMIN_USER_IDS'),
    roleIds: parseCsvEnv('ADMIN_ROLE_IDS'),
    roleNames: normalizeRoleNames(parseCsvEnv('ADMIN_ROLE_NAMES')),
  };
  writeJsonAtomic(FILE, data);
  reload();
  const total = data.userIds.length + data.roleIds.length + data.roleNames.length;
  if (total) {
    console.log(`[SUBS] Created subs-admins.json (${data.userIds.length} users, ${data.roleIds.length} roles)`);
  } else {
    console.log('[SUBS] Created subs-admins.json (empty — add admins from subs panel)');
  }
}

let watchStarted = false;

function startWatching(onReload = null) {
  if (watchStarted) return;
  watchStarted = true;
  if (!fs.existsSync(FILE)) return;
  watchJson(FILE, () => {
    reload();
    if (typeof onReload === 'function') onReload();
  }, { debounceMs: 200 });
}

function getAdminGuildId() {
  ensureLoaded();
  return cache.adminGuildId || null;
}

/** Set (or clear with null) the admin server chosen in the dashboard. */
function setAdminGuildId(guildId) {
  ensureLoaded();
  const id = guildId == null ? null : String(guildId).trim();
  if (id !== null && !/^\d{17,20}$/.test(id)) throw new Error('bad guild id');
  cache = { ...cache, adminGuildId: id };
  writeCache();
}

module.exports = {
  getAdminGuildId,
  setAdminGuildId,
  listUserIds,
  listRoleIds,
  listRoleNames,
  addUser,
  removeUser,
  addRole,
  removeRole,
  addRoleName,
  removeRoleName,
  removeEntry,
  seedFromEnv,
  startWatching,
  reload,
};
