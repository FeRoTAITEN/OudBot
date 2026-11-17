const fs = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic, watchJson, isUnreadable } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'guild-channels.json');
const LEGACY_FILE = path.join(__dirname, '..', '..', 'data', 'bot-channels.json');
let cache = {};
let loaded = false;
let lastSerialized = '';

function emptyGuild() {
  return { master: {}, slaves: {} };
}

function normalizeGuildEntry(raw) {
  if (!raw || typeof raw !== 'object') return emptyGuild();
  if (raw.master || raw.slaves) {
    return {
      master: raw.master && typeof raw.master === 'object' ? { ...raw.master } : {},
      slaves: raw.slaves && typeof raw.slaves === 'object' ? { ...raw.slaves } : {},
    };
  }
  return emptyGuild();
}

function readAll() {
  const res = readJson(FILE);
  if (!res.exists) return {};
  if (!res.ok) throw new Error('guild-channels.json is unreadable — refusing to overwrite it');
  const raw = res.data;
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [guildId, entry] of Object.entries(raw)) {
    if (/^\d+$/.test(String(guildId))) {
      out[guildId] = normalizeGuildEntry(entry);
    }
  }
  return out;
}

function writeAll(data) {
  if (!loaded && isUnreadable(FILE)) throw new Error('guild-channels.json is unreadable — refusing to overwrite it (fix or restore the file, then retry)');
  writeJsonAtomic(FILE, data);
  lastSerialized = JSON.stringify(data);
}

function reload() {
  let raw;
  try {
    raw = readAll();
  } catch {
    return;
  }
  const serialized = JSON.stringify(raw);
  if (serialized === lastSerialized && loaded) return;
  lastSerialized = serialized;
  cache = raw;
  loaded = true;
}

function ensureLoaded() {
  if (!loaded) reload();
}

let reloadListener = null;
let watchStarted = false;

function startWatching(onReload = null) {
  if (onReload) reloadListener = onReload;
  ensureLoaded();
  if (watchStarted) return;
  watchStarted = true;
  if (!fs.existsSync(FILE)) return;
  watchJson(FILE, () => {
    const before = lastSerialized;
    reload();
    if (lastSerialized === before) return;
    console.log(`[GUILD-CH] guild-channels.json reloaded (${Object.keys(cache).length} guild(s))`);
    if (reloadListener) {
      Promise.resolve(reloadListener()).catch(err => {
        console.warn(`[GUILD-CH] reload hook failed: ${err.message}`);
      });
    }
  }, { debounceMs: 500 });
}

function ensureGuild(guildId) {
  ensureLoaded();
  const id = String(guildId);
  if (!cache[id]) cache[id] = emptyGuild();
  return cache[id];
}

function getGuild(guildId) {
  ensureLoaded();
  return cache[String(guildId)] ? normalizeGuildEntry(cache[String(guildId)]) : emptyGuild();
}

function getMaster(guildId) {
  return getGuild(guildId).master || null;
}

function getSlave(guildId, slaveName) {
  const slaves = getGuild(guildId).slaves || {};
  return slaves[String(slaveName)] ?? null;
}

function mergeBot(guildId, botKey, patch) {
  const id = String(guildId);
  const key = String(botKey);
  const all = readAll();
  const guild = all[id] ? normalizeGuildEntry(all[id]) : emptyGuild();

  if (key === 'master') {
    const prev = guild.master || {};
    const next = { ...prev, ...patch };
    for (const k of Object.keys(next)) {
      if (next[k] === null || next[k] === '') delete next[k];
    }
    const prevCmp = { ...prev };
    const nextCmp = { ...next };
    delete prevCmp.updatedAt;
    delete nextCmp.updatedAt;
    if (JSON.stringify(prevCmp) === JSON.stringify(nextCmp)) {
      all[id] = guild;
      cache = all;
      loaded = true;
      return guild.master;
    }
    next.updatedAt = new Date().toISOString();
    guild.master = next;
  } else {
    const prev = guild.slaves[key] || {};
    const next = { ...prev, ...patch };
    for (const k of Object.keys(next)) {
      if (next[k] === null || next[k] === '') delete next[k];
    }
    const prevCmp = { ...prev };
    const nextCmp = { ...next };
    delete prevCmp.updatedAt;
    delete nextCmp.updatedAt;
    if (JSON.stringify(prevCmp) === JSON.stringify(nextCmp)) {
      all[id] = guild;
      cache = all;
      loaded = true;
      return guild.slaves[key];
    }
    next.updatedAt = new Date().toISOString();
    guild.slaves[key] = next;
  }

  all[id] = guild;
  writeAll(all);
  cache = all;
  loaded = true;
  return key === 'master' ? guild.master : guild.slaves[key];
}

function mergeMaster(guildId, patch) {
  return mergeBot(guildId, 'master', patch);
}

function mergeSlave(guildId, slaveName, patch) {
  return mergeBot(guildId, slaveName, patch);
}

function removeSlave(guildId, slaveName) {
  const id = String(guildId);
  const all = readAll();
  if (!all[id]?.slaves?.[String(slaveName)]) return false;
  delete all[id].slaves[String(slaveName)];
  writeAll(all);
  cache = all;
  return true;
}

function listGuildIds() {
  ensureLoaded();
  return Object.keys(cache);
}

/** Migrate legacy bot-channels.json (master + numeric slaves) → guild-channels.json */
function migrateLegacy(guildId) {
  if (!guildId) return false;
  const legacyRes = readJson(LEGACY_FILE);
  if (!legacyRes.exists) return false;
  if (!legacyRes.ok) return false;
  const legacy = legacyRes.data;
  if (!legacy || typeof legacy !== 'object') return false;

  ensureLoaded();
  const id = String(guildId);
  if (cache[id]?.master?.voiceChannelId) return false;

  const guild = emptyGuild();
  if (legacy.master && typeof legacy.master === 'object') {
    guild.master = { ...legacy.master };
  }
  for (const [key, val] of Object.entries(legacy)) {
    if (key === 'master' || !/^\d+$/.test(key)) continue;
    if (val && typeof val === 'object') guild.slaves[key] = { ...val };
  }

  if (!guild.master.voiceChannelId && !Object.keys(guild.slaves).length) return false;

  const all = readAll();
  all[id] = guild;
  writeAll(all);
  cache = all;
  console.log(`[GUILD-CH] Migrated bot-channels.json → guild-channels.json for guild ${id}`);
  return true;
}

function seedGuildFromEnv(guildId) {
  if (!guildId || fs.existsSync(FILE)) return;
  migrateLegacy(guildId);
  if (fs.existsSync(FILE)) return;
  const all = {};
  all[String(guildId)] = emptyGuild();
  writeAll(all);
  cache = all;
  loaded = true;
  console.log(`[GUILD-CH] Created guild-channels.json for guild ${guildId}`);
}

function ensureGuildEntry(guildId) {
  ensureLoaded();
  const id = String(guildId);
  if (cache[id]) return cache[id];
  const all = readAll();
  all[id] = emptyGuild();
  writeAll(all);
  cache = all;
  loaded = true;
  return cache[id];
}

module.exports = {
  getGuild,
  getMaster,
  getSlave,
  mergeMaster,
  mergeSlave,
  mergeBot,
  removeSlave,
  listGuildIds,
  migrateLegacy,
  seedGuildFromEnv,
  ensureGuildEntry,
  startWatching,
  reload,
};
