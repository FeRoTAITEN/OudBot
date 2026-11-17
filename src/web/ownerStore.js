// ownerStore.js – T82: owners added from the dashboard (same powers as the .env owners).
// data/web-owners.json = { userIds: [] }. Only the .env owners (root owners) may add or remove them.
const path = require('path');
const fs = require('fs');
const { readJson, writeJsonAtomic, isUnreadable } = require('../util/jsonFile');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'web-owners.json');
// Seeded once when the real file does not exist yet (owner request 2026-10-29); removable from the dashboard.
const SEED = ['748301872174989374'];

let FILE = DEFAULT_FILE;
let cache = [];
let loaded = false;

function norm(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(s => String(s).trim()).filter(s => /^\d{17,20}$/.test(s)))];
}

/** Called once by the launcher (not by checks/tools): create the file with the seed if it is missing. */
function seedOnce() {
  if (FILE !== DEFAULT_FILE || fs.existsSync(FILE)) return;
  try { writeJsonAtomic(FILE, { userIds: SEED }); } catch { /* data dir missing */ }
  loaded = false;
}

function reload() {
  const res = readJson(FILE);
  if (!res.exists) { cache = []; loaded = true; return; }
  if (!res.ok) return; // keep last good copy
  cache = norm(res.data?.userIds);
  loaded = true;
}

function ensure() { if (!loaded) reload(); }

function save(ids) {
  if (isUnreadable(FILE)) throw new Error('web-owners.json is unreadable — refusing to overwrite it');
  cache = norm(ids).slice(0, 20);
  writeJsonAtomic(FILE, { userIds: cache });
}

function listUserIds() { ensure(); return [...cache]; }
function has(id) { ensure(); return cache.includes(String(id)); }
function addUser(id) { ensure(); save([...cache, String(id)]); }
function removeUser(id) { ensure(); save(cache.filter(x => x !== String(id))); }

function _setFile(f) { FILE = f; loaded = false; cache = []; }

module.exports = { listUserIds, has, addUser, removeUser, seedOnce, _setFile };
