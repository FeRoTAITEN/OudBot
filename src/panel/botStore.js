const path = require('path');
const { resolveGuildId } = require('../config/channels');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'bots.json');
const LEGACY_SHAPE = /^\d+$/;

function readRaw() {
  const res = readJson(FILE);
  if (!res.exists) return {};
  if (!res.ok) throw new Error('bots.json is unreadable — refusing to modify it');
  const raw = res.data;
  return raw && typeof raw === 'object' ? raw : {};
}

function writeAll(data) {
  writeJsonAtomic(FILE, data);
}

function emptyGuild() {
  return { slaves: {} };
}

function isGuildKeyed(raw) {
  for (const key of Object.keys(raw)) {
    if (LEGACY_SHAPE.test(key) && raw[key]?.token) return false;
    if (/^\d{17,20}$/.test(key)) return true;
  }
  return Object.keys(raw).length === 0;
}

function normalizeGuildEntry(raw) {
  if (!raw || typeof raw !== 'object') return emptyGuild();
  if (raw.slaves && typeof raw.slaves === 'object') {
    return { slaves: { ...raw.slaves } };
  }
  return emptyGuild();
}

function readGuilds() {
  const raw = readRaw();
  if (!isGuildKeyed(raw)) return null;
  const out = {};
  for (const [guildId, entry] of Object.entries(raw)) {
    if (/^\d{17,20}$/.test(guildId)) out[guildId] = normalizeGuildEntry(entry);
  }
  return out;
}

/** Migrate flat { "1": { token, guildId? } } → per-guild file */
function migrateLegacy() {
  const raw = readRaw();
  if (isGuildKeyed(raw)) return false;

  const fallbackGuild = resolveGuildId();
  const guilds = {};

  for (const [name, entry] of Object.entries(raw)) {
    if (!LEGACY_SHAPE.test(name) || !entry?.token) continue;
    const gid = String(entry.guildId || fallbackGuild || '').trim();
    if (!gid) continue;
    if (!guilds[gid]) guilds[gid] = emptyGuild();
    guilds[gid].slaves[name] = {
      token: String(entry.token).trim(),
      updatedAt: entry.updatedAt || new Date().toISOString(),
    };
  }

  if (!Object.keys(guilds).length) return false;
  writeAll(guilds);
  console.log(`[BOTS] Migrated flat bots.json → per-guild (${Object.keys(guilds).length} server(s))`);
  return true;
}

function ensureGuilds() {
  migrateLegacy();
  const guilds = readGuilds();
  if (guilds) return guilds;
  return {};
}

function sanitizeSlaveEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const token = String(entry.token ?? '').trim();
  if (!token) return null;
  const out = { token };
  if (entry.updatedAt) out.updatedAt = entry.updatedAt;
  return out;
}

function listSlaves(guildId = null) {
  const guilds = ensureGuilds();
  const out = [];

  const ids = guildId
    ? [String(guildId)]
    : Object.keys(guilds).sort();

  for (const gid of ids) {
    const slaves = guilds[gid]?.slaves || {};
    for (const name of Object.keys(slaves).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
      const entry = sanitizeSlaveEntry(slaves[name]);
      if (!entry) continue;
      out.push({
        name: String(name),
        token: entry.token,
        guildId: gid,
      });
    }
  }
  return out;
}

function get(guildId, name) {
  const gid = String(guildId);
  const key = String(name);
  const entry = ensureGuilds()[gid]?.slaves?.[key];
  return sanitizeSlaveEntry(entry) ? { ...sanitizeSlaveEntry(entry), guildId: gid } : null;
}

/** Legacy: get by name only — first match across guilds */
function getByName(name) {
  return listSlaves().find(s => s.name === String(name)) || null;
}

function set(guildId, name, patch) {
  const gid = String(guildId);
  const key = String(name);
  const token = String(patch.token ?? '').trim();
  if (!token) throw new Error('Bot token is required.');

  const guilds = ensureGuilds();
  if (!guilds[gid]) guilds[gid] = emptyGuild();
  const prev = guilds[gid].slaves[key] || {};
  guilds[gid].slaves[key] = {
    ...prev,
    token,
    updatedAt: new Date().toISOString(),
  };
  writeAll(guilds);
  return guilds[gid].slaves[key];
}

function remove(guildId, name) {
  const gid = String(guildId);
  const key = String(name);
  const guilds = ensureGuilds();
  if (!guilds[gid]?.slaves?.[key]) return false;
  delete guilds[gid].slaves[key];
  if (!Object.keys(guilds[gid].slaves).length) delete guilds[gid];
  writeAll(guilds);
  return true;
}

function nextSlaveName(guildId) {
  const gid = String(guildId);
  const slaves = ensureGuilds()[gid]?.slaves || {};
  const names = Object.keys(slaves)
    .map(n => parseInt(n, 10))
    .filter(n => Number.isFinite(n));
  if (!names.length) return '1';
  return String(Math.max(...names) + 1);
}

function listTokens() {
  return listSlaves().map(s => s.token);
}

module.exports = {
  FILE,
  migrateLegacy,
  listSlaves,
  get,
  getByName,
  set,
  remove,
  nextSlaveName,
  listTokens,
};
