const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic, watchJson, isUnreadable } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'subscriptions.json');
let cache = {};
let loaded = false;
let lastSerialized = '';

function readFile() {
  const res = readJson(FILE);
  if (!res.exists) return {};
  if (!res.ok) return null;
  return res.data && typeof res.data === 'object' ? res.data : null;
}

function reload() {
  const raw = readFile();
  if (raw == null || typeof raw !== 'object') return false;
  const serialized = JSON.stringify(raw);
  if (serialized === lastSerialized && loaded) return true;
  lastSerialized = serialized;
  cache = raw;
  loaded = true;
  return true;
}

function reloadWithRetry() {
  const beforeAllowed = loaded ? listGuildIds().length : 0;
  const ok = reload();
  if (!ok) return false;
  const allIds = listAllGuildIds();
  const allowed = listGuildIds().length;
  // Editor may save twice — ignore a transient empty read while keys still exist.
  if (beforeAllowed > 0 && allowed === 0 && allIds.length > 0) {
    return new Promise(resolve => {
      setTimeout(() => {
        reload();
        resolve(true);
      }, 400);
    });
  }
  return Promise.resolve(true);
}

function ensureLoaded() {
  if (!loaded) reload();
}

let reloadListener = null;
let mutateListener = null;
let suppressReloadHook = false;
let watchStarted = false;

const MUTATE_IGNORE_KEYS = new Set(['label']);

function notifyMutate(guildId, meta = {}) {
  if (!mutateListener) return;
  Promise.resolve(mutateListener(String(guildId), meta)).catch(err => {
    console.warn(`[SUB] mutate hook failed: ${err.message}`);
  });
}

function setMutateListener(fn) {
  mutateListener = fn;
}

function startWatching(onReload = null) {
  if (onReload) reloadListener = onReload;
  ensureLoaded();
  if (watchStarted) return;
  watchStarted = true;
  if (!fs.existsSync(FILE)) return;
  watchJson(FILE, () => {
    if (suppressReloadHook) return;
    const before = lastSerialized;
    reloadWithRetry().then(changed => {
      if (!changed || lastSerialized === before) return;
      const n = Object.keys(cache).length;
      console.log(`[SUB] subscriptions.json reloaded (${n} guild(s))`);
      if (reloadListener) {
        Promise.resolve(reloadListener()).catch(err => {
          console.warn(`[SUB] reload hook failed: ${err.message}`);
        });
      }
    });
  }, { debounceMs: 900 });
}

function isLifetimeEntry(entry) {
  if (!entry) return false;
  if (entry.lifetime === false) return false;
  if (entry.lifetime === true || entry.forever === true) return true;
  const exp = entry.expires;
  if (exp == null || exp === '') {
    return entry.lifetime == null && entry.forever == null;
  }
  const s = String(exp).trim().toLowerCase();
  if (s === 'forever' || s === 'never' || s === 'lifetime' || s === 'unlimited') return true;
  return false;
}

function isEntryExpired(entry, lifetime) {
  if (lifetime) return false;
  const raw = entry.expires;
  if (raw == null || String(raw).trim() === '') {
    return entry.lifetime === false;
  }
  const exp = Date.parse(raw);
  if (!Number.isFinite(exp)) return entry.lifetime === false;
  return exp < Date.now();
}

function isGuildAllowed(guildId) {
  return getGuildFeatures(guildId).allowed;
}

function getGuildEntry(guildId) {
  ensureLoaded();
  return cache[String(guildId)] ?? null;
}

function writeCache() {
  if (!loaded && isUnreadable(FILE)) throw new Error('subscriptions.json is unreadable — refusing to overwrite it (fix or restore the file, then retry)');
  suppressReloadHook = true;
  writeJsonAtomic(FILE, cache);
  lastSerialized = JSON.stringify(cache);
  setTimeout(() => { suppressReloadHook = false; }, 2500);
}

function listAllGuildIds() {
  ensureLoaded();
  return Object.keys(cache);
}

function mergeGuild(guildId, patch) {
  ensureLoaded();
  const id = String(guildId);
  if (!cache[id]) return null;
  const prev = { ...cache[id] };
  const next = { ...prev, ...patch };
  if (JSON.stringify(prev) === JSON.stringify(next)) return cache[id];
  cache[id] = next;
  writeCache();
  const patchKeys = Object.keys(patch);
  if (patchKeys.some(k => !MUTATE_IGNORE_KEYS.has(k))) {
    notifyMutate(id, { action: 'merge', patch });
  }
  return cache[id];
}

function defaultGuildEntry(overrides = {}) {
  return {
    active: true,
    music: true,
    bridge: false,
    slaves: true,
    autoRoom: true,
    editSlaveProfile: false,
    maxSlaves: 3,
    lifetime: true,
    ...overrides,
  };
}

function upsertGuild(guildId, patch = {}) {
  ensureLoaded();
  const id = String(guildId);
  if (!/^\d{17,20}$/.test(id)) return null;
  const prev = cache[id] ? { ...cache[id] } : {};
  const next = { ...defaultGuildEntry(), ...prev, ...patch };
  cache[id] = next;
  writeCache();
  notifyMutate(id, { action: 'upsert', patch });
  return next;
}

function removeGuild(guildId) {
  ensureLoaded();
  const id = String(guildId);
  if (!cache[id]) return false;
  delete cache[id];
  writeCache();
  notifyMutate(id, { action: 'remove' });
  return true;
}

function listAllSummaries() {
  ensureLoaded();
  return listAllGuildIds()
    .map(id => ({ guildId: id, ...getGuildFeatures(id) }))
    .sort((a, b) => String(a.label || a.guildId).localeCompare(String(b.label || b.guildId)));
}

/**
 * Write Discord guild name into subscriptions.json label (unless labelLocked).
 */
function syncGuildLabel(guild) {
  if (!guild?.id || !guild.name) return false;
  const id = String(guild.id);
  ensureLoaded();
  const entry = cache[id];
  if (!entry) return false;
  if (entry.labelLocked) return false;
  const name = guild.name.trim();
  if (!name) return false;
  const prev = (entry.label || '').trim();
  if (prev === name) return false;
  mergeGuild(id, { label: name });
  console.log(`[SUB] Label updated for ${id} → ${name}`);
  return true;
}

async function syncAllGuildLabels(client) {
  if (!client) return;
  ensureLoaded();
  let changed = false;
  for (const id of listAllGuildIds()) {
    const guild = client.guilds.cache.get(id)
      ?? await client.guilds.fetch(id).catch(() => null);
    if (!guild?.name) continue;
    const entry = cache[id];
    if (!entry || entry.labelLocked) continue;
    const name = guild.name.trim();
    if (!name || (entry.label || '').trim() === name) continue;
    cache[id] = { ...entry, label: name };
    changed = true;
    console.log(`[SUB] Label updated for ${id} → ${name}`);
  }
  if (changed) writeCache();
}

function parseMaxSlaves(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Per-guild subscription — all fields set directly in subscriptions.json. */
function getGuildFeatures(guildId) {
  ensureLoaded();
  const id = String(guildId);
  const entry = cache[id];
  if (!entry) {
    return {
      allowed: false,
      active: false,
      guildId: id,
      label: null,
      lifetime: false,
      bridge: false,
      slaves: false,
      maxSlaves: 0,
      music: false,
      autoRoom: true,
      editSlaveProfile: true,
      webListen: false,
      expired: false,
      note: null,
    };
  }

  const lifetime = isLifetimeEntry(entry);
  const expired = isEntryExpired(entry, lifetime);

  const active = entry.active != null
    ? Boolean(entry.active)
    : (entry.subscribed != null ? Boolean(entry.subscribed) : true);

  const autoRoom = true;

  const bridge = Boolean(entry.bridge);
  const slaves = entry.slaves != null ? Boolean(entry.slaves) : bridge;

  return {
    allowed: active && !expired,
    active,
    guildId: id,
    label: entry.label || entry.note || id,
    lifetime,
    bridge,
    slaves,
    maxSlaves: parseMaxSlaves(entry.maxSlaves),
    music: entry.music != null ? Boolean(entry.music) : true,
    autoRoom,
    editSlaveProfile: entry.editSlaveProfile != null
      ? Boolean(entry.editSlaveProfile)
      : true,
    // Web listening lets people outside Discord hear the rooms: the server owner turns it on (T41).
    webListen: entry.webListen != null ? Boolean(entry.webListen) : false,
    expired,
    note: entry.note || null,
    expires: entry.expires || null,
  };
}

function guildHasBridge(guildId) {
  const f = getGuildFeatures(guildId);
  return f.allowed && f.bridge;
}

function guildHasSlaves(guildId) {
  const f = getGuildFeatures(guildId);
  return f.allowed && f.slaves;
}

function getMaxSlavesForGuild(guildId) {
  const f = getGuildFeatures(guildId);
  return f.allowed && f.slaves ? f.maxSlaves : 0;
}

function listGuildIds() {
  ensureLoaded();
  return Object.keys(cache).filter(id => isGuildAllowed(id));
}

function seedFromEnv() {
  const guildId = process.env.GUILD_ID?.trim();
  if (!guildId) return;
  if (fs.existsSync(FILE)) return;
  const data = {
    [guildId]: {
      label: 'Main server',
      music: true,
      bridge: true,
      maxSlaves: 5,
      lifetime: true,
      note: 'seed from GUILD_ID',
    },
  };
  writeJsonAtomic(FILE, data);
  reload();
  console.log(`[SUB] Created subscriptions.json for guild ${guildId}`);
}

module.exports = {
  isGuildAllowed,
  isLifetimeEntry,
  getGuildEntry,
  getGuildFeatures,
  guildHasBridge,
  guildHasSlaves,
  getMaxSlavesForGuild,
  listGuildIds,
  listAllGuildIds,
  mergeGuild,
  upsertGuild,
  removeGuild,
  listAllSummaries,
  defaultGuildEntry,
  syncGuildLabel,
  syncAllGuildLabels,
  seedFromEnv,
  startWatching,
  setMutateListener,
  MUTATE_IGNORE_KEYS,
  reload,
  reloadWithRetry,
};
