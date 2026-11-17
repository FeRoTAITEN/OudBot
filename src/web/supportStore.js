// supportStore.js – T82: support tickets (complaints, suggestions, problems, questions) from the dashboard.
// data/support.json = { seq, tickets: [{ id, kind, status, guildId, userId, userName, title, created, updated,
//   unreadUser, unreadStaff, messages: [{ staff, name, text, ts }] }] }.
const path = require('path');
const { readJson, writeJsonAtomic, isUnreadable } = require('../util/jsonFile');

let FILE = path.join(__dirname, '..', '..', 'data', 'support.json');
const KINDS = ['complaint', 'suggestion', 'problem', 'question'];
const STATUSES = ['open', 'answered', 'closed'];
const MAX_TICKETS = 1000;
const MAX_MESSAGES = 100;
const MAX_OPEN_PER_USER = 5;
const TITLE_MAX = 100;
const TEXT_MAX = 2000;

let data = { seq: 0, tickets: [] };
let loaded = false;

function load() {
  if (loaded) return;
  const res = readJson(FILE);
  if (res.exists && !res.ok) throw new Error('support.json is unreadable');
  if (res.ok && res.data && Array.isArray(res.data.tickets)) data = { seq: Number(res.data.seq) || 0, tickets: res.data.tickets };
  loaded = true;
}

function save() {
  if (isUnreadable(FILE)) throw new Error('support.json is unreadable — refusing to overwrite it');
  // Keep the newest tickets; closed ones go first when over the cap.
  if (data.tickets.length > MAX_TICKETS) {
    const drop = data.tickets.filter(x => x.status === 'closed').sort((a, b) => a.updated - b.updated).slice(0, data.tickets.length - MAX_TICKETS);
    const ids = new Set(drop.map(x => x.id));
    data.tickets = data.tickets.filter(x => !ids.has(x.id));
    if (data.tickets.length > MAX_TICKETS) data.tickets = data.tickets.slice(-MAX_TICKETS);
  }
  writeJsonAtomic(FILE, data);
}

const clean = (s, max) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

function summary(x) {
  const last = x.messages[x.messages.length - 1];
  return {
    id: x.id, kind: x.kind, status: x.status, guildId: x.guildId, userId: x.userId, userName: x.userName, title: x.title,
    created: x.created, updated: x.updated, count: x.messages.length, unreadUser: x.unreadUser, unreadStaff: x.unreadStaff,
    lastBy: last ? (last.staff ? 'staff' : 'user') : null,
  };
}

/** Tickets this viewer may see (staff: all, others: their own), newest first. */
function list({ userId = null, staff = false, status = null } = {}) {
  load();
  return data.tickets
    .filter(x => (staff || (userId && x.userId === String(userId))) && (!status || x.status === status))
    .sort((a, b) => b.updated - a.updated)
    .map(summary);
}

function get(id) {
  load();
  return data.tickets.find(x => x.id === Number(id)) || null;
}

function canSee(ticket, { userId, staff }) {
  return Boolean(ticket && (staff || (userId && ticket.userId === String(userId))));
}

function create({ userId, userName, kind, guildId, title, text }) {
  load();
  const k = KINDS.includes(kind) ? kind : null;
  if (!k) throw new Error('bad kind');
  const tt = clean(title, TITLE_MAX);
  const body = clean(text, TEXT_MAX);
  if (tt.length < 3) throw new Error('title too short');
  if (body.length < 5) throw new Error('text too short');
  const uid = userId ? String(userId) : null;
  if (uid && data.tickets.filter(x => x.userId === uid && x.status !== 'closed').length >= MAX_OPEN_PER_USER) throw new Error('too many open tickets');
  const now = Date.now();
  const ticket = {
    id: ++data.seq, kind: k, status: 'open', guildId: /^\d{17,20}$/.test(String(guildId || '')) ? String(guildId) : null,
    userId: uid, userName: clean(userName, 64) || null, title: tt, created: now, updated: now,
    unreadUser: false, unreadStaff: true, messages: [{ staff: false, name: clean(userName, 64) || null, text: body, ts: now }],
  };
  data.tickets.push(ticket);
  save();
  return ticket;
}

function reply(id, { staff, name, text }) {
  load();
  const x = get(id);
  if (!x) throw new Error('not found');
  const body = clean(text, TEXT_MAX);
  if (body.length < 1) throw new Error('empty reply');
  if (x.messages.length >= MAX_MESSAGES) throw new Error('too many replies');
  x.messages.push({ staff: Boolean(staff), name: clean(name, 64) || null, text: body, ts: Date.now() });
  x.updated = Date.now();
  x.status = staff ? 'answered' : 'open';
  if (staff) x.unreadUser = true; else x.unreadStaff = true;
  save();
  return x;
}

function setStatus(id, status) {
  load();
  const x = get(id);
  if (!x) throw new Error('not found');
  if (!STATUSES.includes(status)) throw new Error('bad status');
  x.status = status;
  x.updated = Date.now();
  save();
  return x;
}

function markRead(id, { staff }) {
  load();
  const x = get(id);
  if (!x) return;
  const key = staff ? 'unreadStaff' : 'unreadUser';
  if (!x[key]) return;
  x[key] = false;
  save();
}

/** Unread count for the nav badge. */
function unreadCount({ userId, staff }) {
  load();
  return data.tickets.filter(x => (staff ? x.unreadStaff && x.status !== 'closed' : (x.userId === String(userId || '') && x.unreadUser))).length;
}

function _setFile(f) { FILE = f; loaded = false; data = { seq: 0, tickets: [] }; }

module.exports = { KINDS, STATUSES, TITLE_MAX, TEXT_MAX, list, get, canSee, create, reply, setStatus, markRead, unreadCount, _setFile };
