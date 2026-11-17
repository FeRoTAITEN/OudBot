// runtimeSettings.js – T60: settings people toggle at runtime survive a restart (review R5, B1, F1).
// data/runtime-settings.json:
//   mixer:        { "<guild>:<room>" | "<guild>:<room>:<user>": { muted, volume, bridgeEnabled, userMuted } }
//   masterPaused: [guildId]           main bot voice paused in that server
//   slavePaused:  ["<guild>:<name>"]  room bot voice paused
// Only non-default values are stored. Solo stays runtime on purpose.
'use strict';
const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'runtime-settings.json');
const SAVE_DELAY_MS = 1000;
const MIXER_DEFAULTS = { muted: false, volume: 100, bridgeEnabled: true, userMuted: false };

let data = null;
let saveTimer = null;
// Off until the bot starts (launcher calls enable()), so checks and tools never read or write the real file.
let enabled = false;

function load() {
  if (data) return data;
  const res = enabled ? readJson(FILE) : { ok: false };
  const raw = res.ok && res.data && typeof res.data === 'object' ? res.data : {};
  data = {
    mixer: raw.mixer && typeof raw.mixer === 'object' ? raw.mixer : {},
    masterPaused: Array.isArray(raw.masterPaused) ? raw.masterPaused.map(String) : [],
    slavePaused: Array.isArray(raw.slavePaused) ? raw.slavePaused.map(String) : [],
    notices: raw.notices && typeof raw.notices === 'object' ? raw.notices : {},
  };
  return data;
}

function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!data || !enabled) return;
  try { writeJsonAtomic(FILE, data, { backup: false }); } catch (err) {
    console.warn(`[SETTINGS] Could not save runtime settings: ${err.message}`);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  saveTimer.unref?.();
}

/** Saved mixer values for a key (only the non-default ones), or null. */
function getMixer(key) {
  const v = load().mixer[String(key)];
  return v ? { ...v } : null;
}

/** Store the current mixer values for a key; defaults are dropped. */
function saveMixer(key, settings) {
  const d = load();
  const out = {};
  for (const [k, def] of Object.entries(MIXER_DEFAULTS)) {
    if (settings?.[k] !== undefined && settings[k] !== def) out[k] = settings[k];
  }
  const k = String(key);
  const before = JSON.stringify(d.mixer[k] || null);
  if (Object.keys(out).length) d.mixer[k] = out;
  else delete d.mixer[k];
  if (JSON.stringify(d.mixer[k] || null) !== before) scheduleSave();
}

function setListFlag(list, id, on) {
  const d = load();
  const set = new Set(d[list]);
  const had = set.has(id);
  if (on) set.add(id); else set.delete(id);
  if (had !== Boolean(on)) { d[list] = [...set]; scheduleSave(); }
}

const isMasterPaused = (guildId) => load().masterPaused.includes(String(guildId));
const setMasterPaused = (guildId, on) => setListFlag('masterPaused', String(guildId), on);
const slaveKey = (guildId, name) => `${guildId}:${name}`;
const isSlavePaused = (guildId, name) => load().slavePaused.includes(slaveKey(guildId, name));
const setSlavePaused = (guildId, name, on) => setListFlag('slavePaused', slaveKey(guildId, name), on);

/** One-time notices (e.g. "plan expired" per guild+date): true the first time only. */
function claimNotice(key) {
  const d = load();
  const k = String(key);
  if (d.notices[k]) return false;
  d.notices[k] = Date.now();
  scheduleSave();
  return true;
}

process.once('beforeExit', flush);

module.exports = {
  getMixer, saveMixer, isMasterPaused, setMasterPaused, isSlavePaused, setSlavePaused, claimNotice, flush,
  enable: () => { enabled = true; data = null; },
  _setFile: (f) => { FILE = f; data = null; enabled = true; },
};
