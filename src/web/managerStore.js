// managerStore.js – T57: dashboard managers (most web powers, below the owner). Owner adds/removes them
// from the Security page. data/web-managers.json = { userIds: [], scopes: { userId: [guildId] } }.
// T78 (review W1): a manager with a server list is limited to those servers (empty = all servers).
const path = require('path');
const { readJson, writeJsonAtomic, isUnreadable } = require('../util/jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'web-managers.json');
let cache = [];
let scopes = {};
let loaded = false;

function norm(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(s => String(s).trim()).filter(s => /^\d{17,20}$/.test(s)))];
}

function reload() {
  const res = readJson(FILE);
  if (!res.exists) { cache = []; scopes = {}; loaded = true; return; }
  if (!res.ok) return; // keep last good copy
  cache = norm(res.data?.userIds);
  scopes = {};
  for (const [uid, list] of Object.entries(res.data?.scopes || {})) {
    if (cache.includes(uid) && norm(list).length) scopes[uid] = norm(list);
  }
  loaded = true;
}

function ensure() { if (!loaded) reload(); }

function save(ids) {
  if (isUnreadable(FILE)) throw new Error('web-managers.json is unreadable — refusing to overwrite it');
  cache = norm(ids);
  for (const uid of Object.keys(scopes)) if (!cache.includes(uid)) delete scopes[uid];
  writeJsonAtomic(FILE, { userIds: cache, scopes });
}

function listUserIds() { ensure(); return [...cache]; }
function has(id) { ensure(); return cache.includes(String(id)); }
function addUser(id) { ensure(); save([...cache, String(id)]); }
function removeUser(id) { ensure(); save(cache.filter(x => x !== String(id))); }

/** Servers this manager is limited to ([] = every server). */
function scopeOf(id) { ensure(); return [...(scopes[String(id)] || [])]; }
function setScope(id, guildIds) {
  ensure();
  const uid = String(id);
  if (!cache.includes(uid)) throw new Error('not a manager');
  const list = norm(guildIds).slice(0, 200);
  if (list.length) scopes[uid] = list; else delete scopes[uid];
  save(cache);
}

function _setFile(f) { FILE = f; loaded = false; cache = []; scopes = {}; }

module.exports = { listUserIds, has, addUser, removeUser, scopeOf, setScope, _setFile };
