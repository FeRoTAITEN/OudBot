// audit.js – append-only record of every dashboard action (who, what, when, from where)
const path = require('path');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'web-audit.json');
const MAX = 2000;
let items = null;
let timer = null;

function load() {
  if (items) return items;
  const res = readJson(FILE);
  items = res.ok && Array.isArray(res.data) ? res.data : [];
  return items;
}

function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try { writeJsonAtomic(FILE, items, { backup: false }); } catch (err) {
      console.warn(`[WEB] audit write failed: ${err.message}`);
    }
  }, 1000);
  timer.unref?.();
}

function record(ctx, action, details = {}) {
  load();
  items.push({
    ts: Date.now(),
    action,
    user: ctx?.identity?.name || null,
    userId: ctx?.identity?.userId || null,
    role: ctx?.identity?.role || null,
    ip: ctx?.ip || null,
    details,
  });
  if (items.length > MAX) items.splice(0, items.length - MAX);
  persist();
}

function list(limit = 300) {
  return load().slice(-limit).reverse();
}

// Discord music actions -> best-effort audit entries (deduped per member+action+queue).
const recent = new Map();

function recordDiscord(member, queueKey, discordAction) {
  try {
    const need = require('./memberAccess').DISCORD_ACTIONS[discordAction];
    if (!need || !member || !queueKey) return;
    const now = Date.now();
    for (const [k, ts] of recent) if (now - ts > 10000) recent.delete(k);
    const key = `${member.id}|${need}|${queueKey}`;
    const last = recent.get(key);
    if (last && now - last < 3000) return;
    recent.set(key, now);
    record({ identity: { name: member.displayName || member.user?.username || null, userId: member.id, role: 'discord' }, ip: null }, 'queue.' + need, { key: String(queueKey), via: 'discord' });
  } catch (err) { /* audit is best-effort */ }
}

module.exports = { record, list, recordDiscord };
