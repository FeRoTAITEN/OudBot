/** Panel UI id for bulk edit — not a storage key in GLOBAL mode. */
const BULK_BOT_KEY = 'all';

function isBulkPanelKey(botKey) {
  return String(botKey) === BULK_BOT_KEY;
}

function isBulkStorageKey(key) {
  const s = String(key);
  return s === BULK_BOT_KEY || /^\d+:all$/.test(s);
}

function slaveProfileKey(guildId, slaveName) {
  const name = String(slaveName);
  const gid = guildId ? String(guildId) : null;
  if (gid) return `${gid}:${name}`;
  return name;
}

function bulkProfileKey(guildId) {
  if (!guildId) return BULK_BOT_KEY;
  return `${String(guildId)}:all`;
}

/**
 * Resolve panel/registry botKey → profiles.json storage key.
 * Accepts: "all", "1", "master", "766294211233841204:1"
 */
function resolveStorageKey(botKey, guildId = null) {
  const key = String(botKey);
  if (isBulkPanelKey(key)) return bulkProfileKey(guildId);
  if (/^\d+:.+$/.test(key)) return key;
  if (guildId && /^\d+$/.test(key)) return slaveProfileKey(guildId, key);
  return key;
}

function parseStorageKey(key) {
  const s = String(key);
  const m = s.match(/^(\d+):(.+)$/);
  if (m) return { guildId: m[1], name: m[2] };
  return { guildId: null, name: s };
}

function migrateProfiles(raw) {
  const botStore = require('./botStore');
  const out = {};
  let dirty = false;
  const globalAll = raw.all && typeof raw.all === 'object' ? raw.all : null;

  for (const [key, entry] of Object.entries(raw || {})) {
    if (!entry || typeof entry !== 'object') {
      dirty = true;
      continue;
    }
    if (key === 'all') continue;

    if (/^\d+:.+$/.test(key) || key === 'master') {
      out[key] = entry;
      continue;
    }

    if (/^\d+$/.test(key)) {
      const matches = botStore.listSlaves().filter(s => s.name === key);
      if (matches.length) {
        for (const s of matches) {
          const nk = slaveProfileKey(s.guildId, s.name);
          if (!out[nk]) out[nk] = { ...entry };
        }
        dirty = true;
      } else {
        out[key] = entry;
      }
      continue;
    }

    out[key] = entry;
  }

  if (globalAll) {
    const guildIds = [...new Set(botStore.listSlaves().map(s => s.guildId))];
    for (const gid of guildIds) {
      const bk = bulkProfileKey(gid);
      if (!out[bk]) {
        out[bk] = { ...globalAll };
      }
    }
    dirty = true;
  }

  if (JSON.stringify(out) !== JSON.stringify(raw)) dirty = true;
  return { data: out, dirty };
}

module.exports = {
  BULK_BOT_KEY,
  isBulkPanelKey,
  isBulkStorageKey,
  slaveProfileKey,
  bulkProfileKey,
  resolveStorageKey,
  parseStorageKey,
  migrateProfiles,
};
