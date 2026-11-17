// expiryReminder.js – DM the server owner before a timed subscription ends (opt-in: EXPIRY_REMINDERS=1).
const path = require('path');
const subscriptionStore = require('./subscriptionStore');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');
const { t } = require('../i18n/context');

const FILE = path.join(__dirname, '..', '..', 'data', 'expiry-reminders.json');
const DAY = 86_400_000;
const TAG = '[SUB]';

function enabled() {
  return process.env.EXPIRY_REMINDERS === '1';
}

function thresholds() {
  const list = String(process.env.EXPIRY_REMIND_DAYS || '3,1')
    .split(',').map(s => parseInt(s, 10)).filter(n => n > 0 && n <= 60);
  return [...new Set(list)].sort((a, b) => b - a);
}

function loadState() {
  const res = readJson(FILE);
  return res.ok && res.data && typeof res.data === 'object' ? res.data : {};
}

/**
 * Pure planner: which guilds get a reminder now. Marks every threshold at or above the
 * current one as sent, so a late start sends one message (the most urgent), not several.
 */
function plan(summaries, state, now = Date.now(), days = thresholds()) {
  const due = [];
  const next = { ...state };
  for (const s of summaries) {
    if (!s.allowed || s.lifetime || !s.expires) continue;
    const exp = Date.parse(s.expires);
    if (!Number.isFinite(exp) || exp <= now) continue;
    const left = (exp - now) / DAY;
    const prev = next[s.guildId]?.expires === s.expires ? next[s.guildId] : { expires: s.expires, sent: [] };
    const hit = days.filter(d => left <= d && !prev.sent.includes(d));
    if (!hit.length) { next[s.guildId] = prev; continue; }
    const most = Math.min(...hit);
    next[s.guildId] = { expires: s.expires, sent: [...new Set([...prev.sent, ...days.filter(d => d >= most)])] };
    due.push({ guildId: s.guildId, label: s.label, expires: s.expires, daysLeft: Math.max(1, Math.ceil(left)) });
  }
  for (const gid of Object.keys(next)) {
    if (!summaries.some(s => s.guildId === gid)) delete next[gid];
  }
  return { due, state: next };
}

async function dmOwner(client, item) {
  const guild = client.guilds.cache.get(String(item.guildId));
  if (!guild) return false;
  const owner = guild.ownerId ? await client.users.fetch(guild.ownerId).catch(() => null) : null;
  if (!owner) return false;
  const text = t('subs.expiryReminder', {
    guild: guild.name,
    days: item.daysLeft,
    date: String(item.expires).slice(0, 10),
  });
  return Boolean(await owner.send({ content: text }).catch(() => null));
}

async function run(client) {
  if (!enabled() || !client) return [];
  const before = loadState();
  const { due, state } = plan(subscriptionStore.listAllSummaries(), before);
  const results = [];
  for (const item of due) {
    const ok = await dmOwner(client, item);
    results.push({ ...item, ok });
    console.log(`${TAG} Expiry reminder ${ok ? 'sent' : 'FAILED'} for ${item.label} (${item.guildId}), ${item.daysLeft}d left`);
  }
  if (JSON.stringify(state) !== JSON.stringify(before)) writeJsonAtomic(FILE, state, { backup: false });
  return results;
}

module.exports = { enabled, thresholds, plan, run };
