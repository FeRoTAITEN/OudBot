// adminView.js – T81: what server admins (Manage Server) see and may change, per section.
// Owner and managers set it: a default for every server, and per-server overrides.
// Levels: show (see + change), read (see only), hide (not shown, refused). Owner/managers always get "show".
// data/admin-view.json = { default: { section: level }, guilds: { guildId: { section: level } } }
'use strict';
const path = require('path');
const { readJson, writeJsonAtomic, watchJson } = require('../util/jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'admin-view.json');
const ID_RE = /^\d{17,20}$/;
const LEVELS = ['show', 'read', 'hide'];

// Dashboard tab/card and Discord panel view each section covers.
const SECTIONS = Object.freeze([
  'music', // music controls (dashboard music tab; Discord: admin control of songs)
  'stats', // statistics tab
  'plan', // subscription / plan tab and renewal request
  'rooms', // room assignment (main bot rooms + room bot rooms)
  'voice', // main bot voice: pause / resume / reconnect
  'roomBots', // room bots: pause / resume / reconnect
  'botEdit', // bot names, avatars, status; add / remove bots (Discord panel)
  'bridge', // bridge mixer: mute, solo, volume, person mute
  'guests', // guest listening links
  'webListen', // listening from the dashboard
  'perms', // member permissions (DJ roles, bans, listener settings, limits)
]);

let data = { default: {}, guilds: {} };
let loaded = false;

function clean(map) {
  const out = {};
  for (const s of SECTIONS) if (LEVELS.includes(map?.[s])) out[s] = map[s];
  return out;
}

function reload() {
  const res = readJson(FILE);
  if (!res.exists) { data = { default: {}, guilds: {} }; loaded = true; return; }
  if (!res.ok) return; // keep the last good copy
  const guilds = {};
  for (const [gid, m] of Object.entries(res.data?.guilds || {})) {
    if (ID_RE.test(gid) && Object.keys(clean(m)).length) guilds[gid] = clean(m);
  }
  data = { default: clean(res.data?.default), guilds };
  loaded = true;
}

let watching = false;
function ensure() {
  if (!loaded) reload();
  if (!watching) {
    watching = true;
    try { watchJson(FILE, reload); } catch { /* no watch in tests */ }
  }
}

function save() { writeJsonAtomic(FILE, data); }

/** Effective level of every section for server admins of this server. */
function effective(guildId) {
  ensure();
  const g = data.guilds[String(guildId)] || {};
  const out = {};
  for (const s of SECTIONS) out[s] = g[s] || data.default[s] || 'show';
  return out;
}

function levelOf(guildId, section) {
  return effective(guildId)[section] || 'show';
}

/** Raw settings for the editor: default map and this server's overrides. */
function raw(guildId) {
  ensure();
  return { default: { ...data.default }, guild: { ...(data.guilds[String(guildId)] || {}) } };
}

/** patch: { section: level | null }; null (or 'inherit') removes the override. */
function apply(target, patch) {
  for (const [s, v] of Object.entries(patch || {})) {
    if (!SECTIONS.includes(s)) continue;
    if (v == null || v === 'inherit') delete target[s];
    else if (LEVELS.includes(v)) target[s] = v;
  }
}

function setDefault(patch) {
  ensure();
  apply(data.default, patch);
  save();
  return raw(null).default;
}

function setGuild(guildId, patch) {
  const gid = String(guildId);
  if (!ID_RE.test(gid)) throw new Error('bad guild id');
  ensure();
  const cur = { ...(data.guilds[gid] || {}) };
  apply(cur, patch);
  if (Object.keys(cur).length) data.guilds[gid] = cur;
  else delete data.guilds[gid];
  save();
  return raw(gid).guild;
}

module.exports = {
  SECTIONS, LEVELS, effective, levelOf, raw, setDefault, setGuild,
  _setFile: (f) => { FILE = f; loaded = false; watching = true; },
};
