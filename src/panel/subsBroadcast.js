// subsBroadcast.js – owner broadcast to subscribed servers (Discord /subs panel + web dashboard).
// T54: plan before send (per-server list, skips, exclusions), one message per server by default,
// owner DMs de-duplicated per owner, mass mentions off unless asked, optional English version per
// server language, one broadcast at a time, history with retry of failed recipients.
const path = require('path');
const { getMasterChannels, mergeSlaveChannelCfg } = require('../config/channels');
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const botStore = require('./botStore');
const { discordMessageSend } = require('../util/discordRetry');
const { readJson, writeJsonAtomic } = require('../util/jsonFile');
const { t } = require('../i18n/context');

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1200;
const DRAFT_TTL_MS = 15 * 60 * 1000;
const HISTORY_MAX = 50;
const MAX_LEN = 2000;

let HIST_FILE = path.join(__dirname, '..', '..', 'data', 'broadcasts.json');
let LANG_FILE = path.join(__dirname, '..', '..', 'data', 'broadcast-langs.json');

/** @type {Map<string, { target: string, guildId: string|null, message: string, createdAt: number }>} */
const drafts = new Map();
let busy = false;

const MASTER_SUFFIX = '_master';

function broadcastBaseTarget(target) {
  const id = String(target);
  if (id.endsWith(MASTER_SUFFIX)) return id.slice(0, -MASTER_SUFFIX.length);
  return id;
}

function isMasterOnly(target) {
  const id = String(target);
  return id.endsWith(MASTER_SUFFIX) && broadcastBaseTarget(id) !== 'owners';
}

function isOwnersTarget(target) {
  return broadcastBaseTarget(target) === 'owners';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pruneDrafts() {
  const now = Date.now();
  for (const [uid, d] of drafts) {
    if (now - d.createdAt > DRAFT_TTL_MS) drafts.delete(uid);
  }
}

function getDraft(userId) {
  pruneDrafts();
  const d = drafts.get(String(userId));
  if (!d) return { target: 'active', guildId: null, message: '', createdAt: Date.now() };
  return d;
}

function saveDraft(userId, patch) {
  pruneDrafts();
  const id = String(userId);
  const prev = getDraft(id);
  const next = { ...prev, ...patch, createdAt: Date.now() };
  drafts.set(id, next);
  return next;
}

function clearDraft(userId) {
  drafts.delete(String(userId));
}

// ---------- per-server language (owner picks it on the dashboard; default Arabic) ----------
function langs() {
  const j = readJson(LANG_FILE).data;
  return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
}

function setLang(guildId, lang) {
  const all = langs();
  if (lang === 'en') all[String(guildId)] = 'en';
  else delete all[String(guildId)];
  writeJsonAtomic(LANG_FILE, all, { backup: false });
  return all;
}

function langOf(guildId, map = langs()) {
  return map[String(guildId)] === 'en' ? 'en' : 'ar';
}

// ---------- history ----------
function history() {
  const j = readJson(HIST_FILE).data;
  return Array.isArray(j) ? j : [];
}

function saveRecord(rec) {
  const list = history().filter(r => r.id !== rec.id);
  list.unshift(rec);
  writeJsonAtomic(HIST_FILE, list.slice(0, HISTORY_MAX), { backup: false });
}

function resolveGuildDisplayName(client, guildId) {
  const id = String(guildId);
  const label = subscriptionStore.getGuildFeatures(id)?.label;
  const g = client?.guilds?.cache?.get(id);
  return g?.name || label || id;
}

function resolveGuildIds(draft, client) {
  if (draft.guildId) return [String(draft.guildId)];
  const summaries = subscriptionStore.listAllSummaries();
  const base = broadcastBaseTarget(draft.target);
  if (base === 'all' || base === 'owners') {
    // Every subscribed server plus any server the main bot is in but that is not in the store.
    const ids = new Set(subscriptionStore.listAllGuildIds().map(String));
    for (const id of client?.guilds?.cache?.keys?.() || []) ids.add(String(id));
    return [...ids];
  }
  if (base === 'active') return subscriptionStore.listGuildIds();
  if (base === 'inactive') return summaries.filter(s => !s.allowed).map(s => s.guildId);
  if (base === 'expired') return summaries.filter(s => s.expired).map(s => s.guildId);
  return [];
}

function resolveGuildBroadcastTargets(masterClient, guildId, { masterOnly = false } = {}) {
  const gid = String(guildId);
  const targets = [];
  const seenChannels = new Set();

  const add = (botKey, channelId, sendClient) => {
    const id = String(channelId || '').trim();
    if (!id || seenChannels.has(id)) return;
    seenChannels.add(id);
    targets.push({
      guildId: gid,
      channelId: id,
      botKey,
      sendClient: sendClient || masterClient,
    });
  };

  const masterText = getMasterChannels(gid).textChannelId;
  if (masterText) {
    add('master', masterText, registry.state.master?.client || masterClient);
  }

  if (!masterOnly) {
    for (const { name } of botStore.listSlaves(gid)) {
      const cfg = mergeSlaveChannelCfg({
        name,
        guildId: gid,
        channelId: null,
        textChannelId: null,
      });
      if (!cfg.textChannelId) continue;
      const entry = registry.getSlaveEntry(gid, name);
      add(name, cfg.textChannelId, entry?.client || masterClient);
    }
  }

  return targets;
}

function channelName(client, guildId, channelId) {
  return client?.guilds?.cache?.get(String(guildId))?.channels?.cache?.get(String(channelId))?.name || null;
}

/**
 * What a broadcast would do, without sending. mode 'one' (default) = one channel per server
 * (main bot's channel first); 'all' = every bot's channel. Owners: one DM per owner.
 * @returns {{ kind: 'channels'|'owners', items: object[], messages: number, servers: number }}
 */
function plan(client, draft) {
  const exclude = new Set((draft.exclude || []).map(String));
  const ids = resolveGuildIds(draft, client).map(String);
  const lmap = langs();
  if (isOwnersTarget(draft.target)) {
    const byOwner = new Map();
    const items = [];
    for (const gid of ids) {
      const g = client?.guilds?.cache?.get(gid);
      const base = { guildId: gid, guildName: resolveGuildDisplayName(client, gid), lang: langOf(gid, lmap), excluded: exclude.has(gid) };
      if (!g) { items.push({ ...base, skip: 'no_guild', guildIds: [gid] }); continue; }
      const ownerId = String(g.ownerId || '');
      if (!ownerId) { items.push({ ...base, skip: 'no_owner', guildIds: [gid] }); continue; }
      const prev = byOwner.get(ownerId);
      if (prev) {
        prev.guildIds.push(gid);
        prev.guildNames.push(base.guildName);
        prev.dupOf = true;
        if (!base.excluded) prev.excluded = false;
        continue;
      }
      const it = { ...base, ownerId, ownerTag: client?.users?.cache?.get(ownerId)?.tag || null, guildIds: [gid], guildNames: [base.guildName], skip: null };
      byOwner.set(ownerId, it);
      items.push(it);
    }
    for (const it of items) if (it.guildNames) it.guildName = it.guildNames.join('، ');
    items.sort((a, b) => Boolean(a.skip) - Boolean(b.skip));
    const live = items.filter(i => !i.skip && !i.excluded);
    return { kind: 'owners', items, messages: live.length, servers: live.reduce((n, i) => n + i.guildIds.length, 0) };
  }
  const masterOnly = isMasterOnly(draft.target);
  const items = ids.map((gid) => {
    // Subscribed but not joined: stale channel config must not count; a slave that is in the server still can send.
    let targets = resolveGuildBroadcastTargets(client, gid, { masterOnly })
      .filter(x => x.sendClient?.guilds?.cache?.has?.(gid));
    if (draft.mode !== 'all') targets = targets.slice(0, 1);
    const joined = Boolean(client?.guilds?.cache?.has?.(gid));
    return {
      guildId: gid,
      guildName: resolveGuildDisplayName(client, gid),
      lang: langOf(gid, lmap),
      excluded: exclude.has(gid),
      skip: targets.length ? null : joined ? 'no_channel' : 'no_guild',
      targets: targets.map(x => ({ ...x, channelName: channelName(client, gid, x.channelId) })),
    };
  });
  items.sort((a, b) => Boolean(a.skip) - Boolean(b.skip));
  const live = items.filter(i => !i.skip && !i.excluded);
  return { kind: 'channels', items, messages: live.reduce((n, i) => n + i.targets.length, 0), servers: live.length };
}

function countRecipients(client, draft) {
  return plan(client, draft).messages;
}

function targetLabel(client, draft) {
  if (draft.guildId) {
    const name = resolveGuildDisplayName(client, draft.guildId);
    if (isOwnersTarget(draft.target)) {
      return t('subs.broadcastTargetOneOwner', { name });
    }
    if (isMasterOnly(draft.target)) {
      return t('subs.broadcastTargetOneMaster', { name });
    }
    return t('subs.broadcastTargetOneChannel', { name });
  }
  const map = {
    all: t('subs.broadcastTargetAll'),
    active: t('subs.broadcastTargetActive'),
    active_master: t('subs.broadcastTargetActiveMaster'),
    inactive: t('subs.broadcastTargetInactive'),
    inactive_master: t('subs.broadcastTargetInactiveMaster'),
    expired: t('subs.broadcastTargetExpired'),
    owners: t('subs.broadcastTargetOwners'),
  };
  return map[draft.target] || draft.target;
}

async function fetchGuild(client, guildId) {
  return client.guilds.cache.get(guildId)
    ?? await client.guilds.fetch(guildId).catch(() => null);
}

async function fetchTextChannel(client, guildId, channelId) {
  if (!client || !channelId) return null;
  const guild = await fetchGuild(client, guildId);
  if (!guild) return null;
  let ch = guild.channels.cache.get(channelId);
  if (!ch) ch = await guild.channels.fetch(channelId).catch(() => null);
  return ch?.isTextBased?.() ? ch : null;
}

async function fetchOwnerUser(client, guild, ownerId) {
  const id = ownerId || guild?.ownerId;
  if (id) {
    const u = await client.users.fetch(id).catch(() => null);
    if (u) return u;
  }
  if (!guild) return null;
  try {
    return (await guild.fetchOwner())?.user ?? null;
  } catch {
    return null;
  }
}

/** Discord API error -> short reason code the UI translates. */
function reasonOf(err, fallback) {
  const code = Number(err?.code);
  if (code === 50013) return 'no_perm';
  if (code === 50001) return 'no_access';
  if (code === 50007) return 'dm_closed';
  if (code === 10003) return 'no_channel';
  if (code === 10004) return 'no_guild';
  return fallback;
}

function payload(content, mentions) {
  return {
    content: content.slice(0, MAX_LEN),
    allowedMentions: mentions ? { parse: ['everyone', 'roles', 'users'] } : { parse: [] },
  };
}

function textFor(draft, lang) {
  const en = String(draft.messageEn || '').trim();
  return lang === 'en' && en ? en : String(draft.message || '').trim();
}

async function sendToBroadcastTarget(masterClient, target, content, mentions = false) {
  const { guildId, channelId, botKey, sendClient } = target;
  const client = sendClient || masterClient;
  const guildName = resolveGuildDisplayName(masterClient, guildId);
  const base = { guildId, guildName, botKey, channelId, lang: target.lang || 'ar' };
  const guild = await fetchGuild(client, guildId);
  if (!guild) return { ...base, ok: false, channelName: null, reason: 'no_guild' };
  const ch = await fetchTextChannel(client, guildId, channelId);
  if (!ch) return { ...base, ok: false, channelName: null, reason: 'no_channel' };
  let err = null;
  const sent = await discordMessageSend(ch, payload(content, mentions)).catch((e) => { err = e; return null; });
  if (!sent) return { ...base, ok: false, channelName: ch.name, reason: reasonOf(err, 'send_failed') };
  return { ...base, ok: true, guildName: ch.guild?.name || guildName, channelName: ch.name };
}

async function sendOwnerDm(client, item, content, mentions = false) {
  const guildId = item.guildId;
  const base = { guildId, guildIds: item.guildIds || [guildId], guildName: item.guildName || resolveGuildDisplayName(client, guildId), lang: item.lang || 'ar' };
  const guild = await fetchGuild(client, guildId);
  if (!guild) return { ...base, ok: false, reason: 'no_guild' };
  const owner = await fetchOwnerUser(client, guild, item.ownerId);
  if (!owner) return { ...base, ok: false, reason: 'no_owner' };
  let err = null;
  const sent = await discordMessageSend(owner, payload(content, mentions)).catch((e) => { err = e; return null; });
  const who = { ownerId: owner.id, ownerTag: owner.tag };
  if (!sent) return { ...base, ...who, ok: false, reason: reasonOf(err, 'dm_failed') };
  return { ...base, ...who, ok: true };
}

function emptyResults(content) {
  return { ok: 0, fail: 0, total: 0, message: content, delivered: [], failures: [], skipped: [] };
}

function recordResult(results, r) {
  if (r.ok) { results.delivered.push(r); results.ok += 1; } else { results.failures.push(r); results.fail += 1; }
}

async function sendJobs(jobs, results) {
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    for (const r of await Promise.all(batch.map(fn => fn()))) recordResult(results, r);
    if (i + BATCH_SIZE < jobs.length) await sleep(BATCH_DELAY_MS);
  }
}

function lock() {
  if (busy) { const e = new Error('a broadcast is already running'); e.code = 'BUSY'; throw e; }
  busy = true;
}

/**
 * Send a broadcast. draft: { target, guildId?, exclude?, mode?, mentions?, message, messageEn? }.
 * opts.by = who sent it (history). Throws code BUSY while another broadcast runs.
 */
async function runBroadcast(client, draft, opts = {}) {
  const content = String(draft.message || '').trim();
  if (!content) return { ...emptyResults(content), error: 'empty' };
  lock();
  try {
    const p = plan(client, draft);
    const results = emptyResults(content);
    const mentions = Boolean(draft.mentions);
    const jobs = [];
    for (const it of p.items) {
      if (it.excluded) continue;
      if (it.skip) { results.skipped.push({ guildId: it.guildId, guildName: it.guildName, reason: it.skip }); continue; }
      const text = textFor(draft, it.lang);
      if (p.kind === 'owners') jobs.push(() => sendOwnerDm(client, it, text, mentions));
      else for (const tg of it.targets) jobs.push(() => sendToBroadcastTarget(client, { ...tg, lang: it.lang }, text, mentions));
    }
    results.total = jobs.length;
    await sendJobs(jobs, results);
    const rec = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      by: opts.by || null,
      target: draft.guildId ? 'one' : String(draft.target),
      guildId: draft.guildId || null,
      kind: p.kind,
      mode: draft.mode === 'all' ? 'all' : 'one',
      mentions,
      message: content,
      messageEn: String(draft.messageEn || '').trim() || null,
      ok: results.ok,
      fail: results.fail,
      total: results.total,
      entries: [...results.delivered, ...results.failures].map(stripEntry),
      skipped: results.skipped,
      retries: 0,
    };
    try { saveRecord(rec); } catch (err) { console.warn('[BROADCAST] history save failed:', err?.message || err); }
    results.id = rec.id;
    return results;
  } finally {
    busy = false;
  }
}

function stripEntry(r) {
  const out = {};
  for (const k of ['ok', 'reason', 'guildId', 'guildIds', 'guildName', 'botKey', 'channelId', 'channelName', 'ownerId', 'ownerTag', 'lang']) {
    if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  }
  return out;
}

/** Re-send a past broadcast to the entries that failed. */
async function retryBroadcast(client, id) {
  const rec = history().find(r => r.id === id);
  if (!rec) { const e = new Error('broadcast not found'); e.code = 'NOT_FOUND'; throw e; }
  const failed = rec.entries.filter(e => !e.ok);
  if (!failed.length) return { ok: 0, fail: 0, total: 0, id };
  lock();
  try {
    const draft = { message: rec.message, messageEn: rec.messageEn };
    const results = emptyResults(rec.message);
    const jobs = failed.map((e) => {
      const text = textFor(draft, e.lang);
      if (rec.kind === 'owners') return () => sendOwnerDm(client, { guildId: e.guildId, guildIds: e.guildIds, guildName: e.guildName, ownerId: e.ownerId, lang: e.lang }, text, rec.mentions);
      return () => sendToBroadcastTarget(client, { guildId: e.guildId, channelId: e.channelId, botKey: e.botKey, lang: e.lang, sendClient: e.botKey === 'master' ? (registry.state.master?.client || client) : (registry.getSlaveEntry(e.guildId, e.botKey)?.client || client) }, text, rec.mentions);
    });
    results.total = jobs.length;
    await sendJobs(jobs, results);
    const fresh = [...results.delivered, ...results.failures].map(stripEntry);
    const key = (e) => `${e.guildId}|${e.channelId || ''}|${e.ownerId || ''}`;
    const byKey = new Map(fresh.map(e => [key(e), e]));
    rec.entries = rec.entries.map(e => (e.ok ? e : byKey.get(key(e)) || e));
    rec.ok = rec.entries.filter(e => e.ok).length;
    rec.fail = rec.entries.length - rec.ok;
    rec.retries = (rec.retries || 0) + 1;
    rec.retriedAt = Date.now();
    saveRecord(rec);
    return { ok: results.ok, fail: results.fail, total: results.total, id };
  } finally {
    busy = false;
  }
}

function isBusy() { return busy; }
function _setFiles(hist, lang) { HIST_FILE = hist; LANG_FILE = lang; }

module.exports = {
  getDraft,
  saveDraft,
  clearDraft,
  countRecipients,
  targetLabel,
  resolveGuildDisplayName,
  runBroadcast,
  retryBroadcast,
  resolveGuildBroadcastTargets,
  plan,
  history,
  langs,
  setLang,
  isBusy,
  _setFiles,
  BATCH_SIZE,
  BATCH_DELAY_MS,
  MAX_LEN,
};
