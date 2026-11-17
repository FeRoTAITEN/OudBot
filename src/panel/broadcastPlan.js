// broadcastPlan.js – T76 (review W3): scheduled broadcasts and saved templates for the dashboard.
// data/broadcast-plan.json: { scheduled: [{ id, at, draft, by }], templates: [{ name, message, messageEn }] }
// A scheduled broadcast survives restarts; it is sent by the main bot when its time comes (checked every 30 s).
'use strict';
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'broadcast-plan.json');
const MAX_SCHEDULED = 20;
const MAX_TEMPLATES = 30;
const MAX_AHEAD_MS = 30 * 86_400_000;
const TICK_MS = 30_000;

function load() {
  const res = readJson(FILE);
  if (res.exists && !res.ok) throw new Error('broadcast-plan.json is unreadable — refusing to overwrite it');
  const raw = res.ok && res.data && typeof res.data === 'object' ? res.data : {};
  return {
    scheduled: Array.isArray(raw.scheduled) ? raw.scheduled : [],
    templates: Array.isArray(raw.templates) ? raw.templates : [],
  };
}
const save = (d) => writeJsonAtomic(FILE, d, { backup: false });

function listScheduled() { return load().scheduled.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); }
function listTemplates() { return load().templates; }

function schedule(draft, at, by, now = Date.now()) {
  const when = Date.parse(at);
  if (!Number.isFinite(when) || when < now + 60_000) throw Object.assign(new Error('time must be at least 1 minute ahead'), { code: 'BAD_TIME' });
  if (when > now + MAX_AHEAD_MS) throw Object.assign(new Error('time must be within 30 days'), { code: 'BAD_TIME' });
  const d = load();
  if (d.scheduled.length >= MAX_SCHEDULED) throw Object.assign(new Error('too many scheduled broadcasts'), { code: 'FULL' });
  const item = { id: crypto.randomBytes(4).toString('hex'), at: new Date(when).toISOString(), draft, by: by || null };
  d.scheduled.push(item);
  save(d);
  return item;
}

function unschedule(id) {
  const d = load();
  const before = d.scheduled.length;
  d.scheduled = d.scheduled.filter(x => x.id !== String(id));
  if (d.scheduled.length === before) return false;
  save(d);
  return true;
}

function saveTemplate(name, message, messageEn = '') {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) throw Object.assign(new Error('name required'), { code: 'BAD_NAME' });
  const d = load();
  d.templates = d.templates.filter(x => x.name !== n);
  if (d.templates.length >= MAX_TEMPLATES) throw Object.assign(new Error('too many templates'), { code: 'FULL' });
  d.templates.push({ name: n, message: String(message || '').slice(0, 2000), messageEn: String(messageEn || '').slice(0, 2000) });
  save(d);
  return d.templates;
}

function deleteTemplate(name) {
  const d = load();
  d.templates = d.templates.filter(x => x.name !== String(name));
  save(d);
  return d.templates;
}

/** Take the due items off the list (so a crash mid-send never sends twice). */
function takeDue(now = Date.now()) {
  const d = load();
  const due = d.scheduled.filter(x => Date.parse(x.at) <= now);
  if (!due.length) return [];
  d.scheduled = d.scheduled.filter(x => Date.parse(x.at) > now);
  save(d);
  return due;
}

let timer = null;
function start(getClient) {
  if (timer) return;
  timer = setInterval(async () => {
    const client = getClient();
    if (!client) return;
    let due;
    try { due = takeDue(); } catch (err) { console.warn(`[BROADCAST] Schedule read failed: ${err.message}`); return; }
    const bc = require('./subsBroadcast');
    for (const item of due) {
      try {
        const r = await bc.runBroadcast(client, item.draft, { by: item.by ? `${item.by} (scheduled)` : 'scheduled' });
        console.log(`[BROADCAST] Scheduled ${item.id} sent: ok=${r.ok} fail=${r.fail}`);
      } catch (err) {
        if (err.code === 'BUSY') {
          // Another broadcast is running: try again in a minute.
          try { const d = load(); d.scheduled.push({ ...item, at: new Date(Date.now() + 60_000).toISOString() }); save(d); } catch { /* lost */ }
          continue;
        }
        console.warn(`[BROADCAST] Scheduled ${item.id} failed: ${err.message}`);
      }
    }
  }, TICK_MS);
  timer.unref?.();
}

module.exports = {
  listScheduled, listTemplates, schedule, unschedule, saveTemplate, deleteTemplate, takeDue, start,
  _setFile: (f) => { FILE = f; },
};
