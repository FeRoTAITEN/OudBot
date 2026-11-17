const path = require('path');
const { isBulkStorageKey, migrateProfiles, resolveStorageKey } = require('./profileKeys');
const { readJson, writeJsonAtomic, isUnreadable } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'profiles.json');

const BOT_PERSIST_KEYS = new Set([
  'activityType',
  'activityText',
  'activityUrl',
  'bannerColor',
  'presenceStatus',
]);
const BULK_TEMPLATE_KEYS = new Set(['username', 'displayName']);
const BULK_PERSIST_KEYS = new Set([...BOT_PERSIST_KEYS, ...BULK_TEMPLATE_KEYS]);

const NULLABLE_PERSIST_KEYS = new Set([
  'bannerColor',
  'activityText',
  'activityType',
  'activityUrl',
  'presenceStatus',
]);

function persistKeysFor(storageKey) {
  return isBulkStorageKey(storageKey) ? BULK_PERSIST_KEYS : BOT_PERSIST_KEYS;
}

function pickPersistPatch(botKey, patch, guildId = null) {
  const storageKey = resolveStorageKey(botKey, guildId);
  const allowed = persistKeysFor(storageKey);
  const out = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
  }
  return out;
}

function sanitizeEntry(storageKey, entry) {
  if (!entry || typeof entry !== 'object') return null;
  const allowed = persistKeysFor(storageKey);
  const out = {};
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(entry, k)) out[k] = entry[k];
  }
  const hasData = [...allowed].some(k => Object.prototype.hasOwnProperty.call(out, k));
  if (!hasData) return null;
  if (entry.updatedAt) out.updatedAt = entry.updatedAt;
  return out;
}

function readAll() {
  const res = readJson(FILE);
  if (!res.exists || !res.ok) return {};
  try {
    const raw = res.data;
    const { data: migrated, dirty: migratedDirty } = migrateProfiles(raw);
    const clean = {};
    let dirty = migratedDirty;
    for (const [key, entry] of Object.entries(migrated)) {
      const next = sanitizeEntry(key, entry);
      if (JSON.stringify(next) !== JSON.stringify(entry)) dirty = true;
      if (next) clean[key] = next;
      else if (entry) dirty = true;
    }
    if (dirty) writeAll(clean);
    return clean;
  } catch {
    return {};
  }
}

function writeAll(data) {
  writeJsonAtomic(FILE, data);
}

function get(botKey, guildId = null) {
  const key = resolveStorageKey(botKey, guildId);
  return readAll()[key] ?? null;
}

function merge(botKey, patch, guildId = null) {
  const key = resolveStorageKey(botKey, guildId);
  const all = readAll();
  const prev = all[key] || {};
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  for (const k of Object.keys(next)) {
    if (next[k] === '') delete next[k];
    else if (next[k] === null && !NULLABLE_PERSIST_KEYS.has(k)) delete next[k];
  }
  all[key] = next;
  if (isUnreadable(FILE)) throw new Error('profiles.json is unreadable — refusing to overwrite it');
  writeAll(all);
  return next;
}

function clear(botKey, guildId = null) {
  const key = resolveStorageKey(botKey, guildId);
  const all = readAll();
  let changed = false;
  if (all[key]) {
    delete all[key];
    changed = true;
  }
  // Legacy cleanup
  if (isBulkStorageKey(key) && all.all) {
    delete all.all;
    changed = true;
  }
  if (/^\d+:\d+$/.test(key)) {
    const name = key.split(':').pop();
    if (all[name]) {
      delete all[name];
      changed = true;
    }
  }
  if (!changed) return false;
  if (isUnreadable(FILE)) throw new Error('profiles.json is unreadable — refusing to overwrite it');
  writeAll(all);
  return true;
}

module.exports = { get, merge, clear, pickPersistPatch, FILE };
