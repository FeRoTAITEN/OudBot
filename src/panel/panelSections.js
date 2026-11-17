// panelSections.js – T81: the Discord control panel follows "what server admins see" (web/adminView.js).
// Each panel button/select maps to a section; hidden sections lose their buttons, view-only ones get them
// disabled, and a click that still arrives (old message) is refused. Owner/managers see everything.
'use strict';
const { AsyncLocalStorage } = require('async_hooks');

const viewerStore = new AsyncLocalStorage();

/** Run fn with the member who opened / clicked the panel (buildPanel reads it). */
function runWithViewer(member, fn) {
  return viewerStore.run({ member: member || null }, fn);
}

function currentViewer() {
  return viewerStore.getStore()?.member || null;
}

function parse(customId) {
  const parts = String(customId || '').split(':');
  if (parts[0] !== 'bridge' || parts.length < 2) return null;
  return { action: parts[1], target: parts[2] ?? null, extra: parts.length > 3 ? parts.slice(3).join(':') : null };
}

const nav = (section) => ({ section, write: false });
const change = (section) => ({ section, write: true });
const BRIDGE_ACTIONS = new Set(['bridge', 'mute', 'solo', 'mutesel', 'solosel', 'volsel', 'volmix', 'usermutesel']);

/** { section, write } for a parsed panel id, or null (always allowed: overview, help, back). */
function sectionFor(p) {
  if (!p) return null;
  const { action, target, extra } = p;
  if (action === 'view' || action === 'refresh') {
    return ({ master: nav('voice'), mixer: nav('bridge'), rooms: nav('rooms'), slave: nav('roomBots'), botedit: nav('botEdit'), perms: nav('perms') })[target] || null;
  }
  if (action === 'listpage') {
    if (target === 'rooms') return nav('rooms');
    if (target === 'mixer' || target === 'usermute') return nav('bridge');
    return null;
  }
  if (action === 'navslave') return nav('roomBots');
  if (action === 'navroom') return nav('rooms');
  if (action === 'room') return change('rooms');
  if (action === 'botedit') return target === 'back' ? null : nav('botEdit');
  if (action === 'profile' || action === 'bot') return change('botEdit');
  if (BRIDGE_ACTIONS.has(action)) return change('bridge');
  if (action === 'action') {
    if (target === 'mixer') return change('bridge');
    if (target === 'master') return extra === 'bridge' ? change('bridge') : change('voice');
    if (target === 'slave' || target === 'all') return change('roomBots');
  }
  if (action === 'music') return change('music');
  if (/^perm/.test(action)) return change('perms');
  return null;
}

function levelFor(member, guildId, section) {
  if (!member || !guildId) return 'show';
  try { return require('../web/identity').memberSectionLevel(member, guildId, section); } catch { return 'show'; }
}

/** Why a click is refused (i18n key), or null when allowed. */
function blockReason(member, guildId, sec) {
  if (!sec) return null;
  const lvl = levelFor(member, guildId, sec.section);
  if (lvl === 'hide') return 'panel.sectionHidden';
  if (lvl === 'read' && sec.write) return 'panel.sectionReadOnly';
  return null;
}

/** Drop hidden buttons/selects and disable view-only ones for the current viewer. */
function filterPayload(payload, guild) {
  const member = currentViewer();
  if (!member || !guild?.id) return payload;
  let levels;
  try {
    const identity = require('../web/identity');
    if (identity.isStaffFor(member.id, guild.id)) return payload;
    levels = require('../web/adminView').effective(guild.id);
  } catch { return payload; }
  if (Object.values(levels).every(l => l === 'show')) return payload;
  const rows = [];
  for (const r of payload.components || []) {
    const row = typeof r.toJSON === 'function' ? r.toJSON() : r;
    const kept = [];
    for (const c of row.components || []) {
      const sec = c.custom_id ? sectionFor(parse(c.custom_id)) : null;
      const lvl = sec ? levels[sec.section] : 'show';
      if (lvl === 'hide') continue;
      kept.push(lvl === 'read' && sec.write ? { ...c, disabled: true } : c);
    }
    if (kept.length) rows.push({ ...row, components: kept });
  }
  return { ...payload, components: rows.slice(0, 5) };
}

module.exports = { runWithViewer, currentViewer, sectionFor, blockReason, filterPayload, parse };
