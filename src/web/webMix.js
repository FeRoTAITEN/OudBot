// webMix.js – T41 web listening: one shared mix per guild + selection, pushed to browsers over WebSocket.
// Selections: 'all'  = voices of every bridge room + the main room's music,
//             'main' = exactly what the main bot plays in its room,
//             'room:<name>' = voices in that bridge room + that bot's own music.
// Admin mute / disable of a room apply; Discord solo does not (each listener picks a room here instead).
const bridge = require('../bridge/bridge');
const registry = require('../bridge/registry');
const { RelayStream } = require('../bridge/relayStream');
const { SOURCE_IDLE_MS } = require('../bridge/audioConfig');
const { parseUserSourceKey } = require('../bridge/sourceKey');
const listenHub = require('./listenHub');

const BATCH = 3; // Opus frames per WebSocket message (60 ms)
const MAX_BACKLOG = 256 * 1024; // slow client -> closed (browser reconnects)

function intEnv(name, fallback, min, max) {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
const MAX_PER_GUILD = intEnv('WEB_LISTEN_MAX_ROOM', 25, 1, 500);
const MAX_TOTAL = intEnv('WEB_LISTEN_MAX_TOTAL', 200, 1, 2000);
const MAX_PER_USER = 2;

class WebRelay extends RelayStream {
  /** @param {Record<string, number>|null} gains listener volumes: user id or 'music' -> 0..2 */
  constructor(gains = null) {
    super();
    this.gains = gains;
  }

  _unmutedSources(now = Date.now()) {
    const out = [];
    for (const [name, b] of this._sources) {
      if (registry.isWebMuted(name)) continue;
      if (now - b.lastIn > SOURCE_IDLE_MS) continue;
      if (this.gains && this._listenerGain(name) === 0) continue;
      out.push(name);
    }
    return out;
  }

  _listenerGain(source) {
    const p = parseUserSourceKey(source);
    const id = !p ? null : (p.userId === 'bot' ? 'music' : p.userId);
    const g = id ? this.gains[id] : undefined;
    return Number.isFinite(g) ? g : 1;
  }

  _gainFor(source) {
    const base = super._gainFor(source);
    return this.gains ? base * this._listenerGain(source) : base;
  }
}

/** `${guildId}|${sel}` -> { gid, sel, relay|null, clients: Set<WsConn>, out: Buffer[] } */
const mixes = new Map();
let timer = null;
let nextAt = 0;

function mainEntry(gid) {
  try { return require('../bots/globalVoice').getEntry(String(gid)) || null; } catch { return null; }
}

function slaveRoomOf(gid, channelId) {
  for (const e of registry.state.slaves.values()) {
    if (String(e?.cfg?.guildId) === gid && String(e?.cfg?.channelId) === String(channelId)) return String(e.name ?? e.cfg.name);
  }
  return null;
}

function send(mix, frame) {
  mix.nSent++;
  mix.out.push(frame);
  if (mix.out.length < BATCH) return;
  const parts = [];
  for (const f of mix.out) {
    const h = Buffer.alloc(2);
    h.writeUInt16BE(f.length);
    parts.push(h, f);
  }
  mix.out = [];
  const msg = Buffer.concat(parts);
  for (const c of mix.clients) {
    if (c.backlog > MAX_BACKLOG) { c.close(1013); continue; }
    c.sendBinary(msg);
  }
}

// Voices captured by the bridge bots.
bridge.on('audio', (frame, source) => {
  if (!mixes.size) return;
  const p = parseUserSourceKey(source);
  if (!p?.guildId) return;
  for (const mix of mixes.values()) {
    if (mix.gid !== p.guildId || !mix.relay) continue;
    if (mix.sel === 'all' || mix.sel === `room:${p.slaveName}`) {
      mix.nIn++;
      mix.relay.addFrame(frame, source);
    }
  }
});

// What the bots play: music, or (main bot) the Discord bridge mix.
listenHub.onPacket((connection, buf) => {
  if (!mixes.size || !buf || buf.length <= 3) return;
  const jc = connection.joinConfig || {};
  const gid = String(jc.guildId || '');
  const room = slaveRoomOf(gid, jc.channelId);
  for (const mix of mixes.values()) {
    if (mix.gid !== gid) continue;
    if (room) {
      if (mix.relay && mix.sel === `room:${room}`) {
        mix.nBot++;
        mix.relay.addFrame(buf, `${gid}:${room}:bot`);
      }
    } else if (mix.sel === 'main') {
      send(mix, buf);
    } else if (mix.sel === 'all' && mix.relay && mainEntry(gid)?.musicActive) {
      // Only music: when the main bot plays the bridge mix, those voices are already in this relay.
      mix.nBot++;
      mix.relay.addFrame(buf, `${gid}:main:bot`);
    }
  }
});

function tick() {
  timer = null;
  if (!mixes.size) return;
  const now = Date.now();
  let steps = 1;
  if (now - nextAt > 20) steps = Math.min(5, Math.floor((now - nextAt) / 20) + 1);
  for (let s = 0; s < steps; s++) {
    for (const mix of mixes.values()) {
      if (!mix.relay) continue;
      const f = mix.relay.read();
      if (f) send(mix, f);
    }
  }
  nextAt = Math.max(nextAt + 20 * steps, now - 100);
  timer = setTimeout(tick, Math.max(0, nextAt + 20 - Date.now()));
}

// T42a: diagnostics while anyone listens — where do room voices get lost?
setInterval(() => {
  if (!mixes.size) return;
  for (const m of mixes.values()) {
    console.log(`[WEBLISTEN] g=${m.gid} sel=${m.sel} clients=${m.clients.size} voiceIn=${m.nIn} botIn=${m.nBot} sent=${m.nSent}`);
    m.nIn = 0; m.nBot = 0; m.nSent = 0;
  }
}, 30000).unref();

// T49: who is talking right now in each mix ('music' = the bot); sent only when it changes.
setInterval(() => {
  if (!mixes.size) return;
  const now = Date.now();
  for (const mix of mixes.values()) {
    if (!mix.relay || !mix.clients.size) continue;
    const ids = [];
    for (const [name, b] of mix.relay._sources) {
      if (now - b.lastIn > 300) continue;
      const p = parseUserSourceKey(name);
      if (p) ids.push(p.userId === 'bot' ? 'music' : String(p.userId));
    }
    const key = [...new Set(ids)].sort().join(',');
    if (key === mix.spk) continue;
    mix.spk = key;
    const msg = JSON.stringify({ spk: key ? key.split(',') : [] });
    for (const c of mix.clients) c.sendText?.(msg);
  }
}, 300).unref();

function total() {
  let n = 0;
  for (const m of mixes.values()) n += m.clients.size;
  return n;
}

/** Limits. null = may join, else { status, error }. */
function check({ guildId, userId }) {
  let inGuild = 0;
  let mine = 0;
  for (const m of mixes.values()) {
    for (const c of m.clients) {
      if (m.gid === String(guildId)) inGuild++;
      if (c.userId === String(userId)) mine++;
    }
  }
  if (inGuild >= MAX_PER_GUILD) return { status: 429, error: 'server full' };
  if (total() >= MAX_TOTAL) return { status: 503, error: 'busy' };
  if (mine >= MAX_PER_USER) return { status: 429, error: 'too many streams' };
  return null;
}

/** Rooms a listener can pick for this guild. */
function selections(guildId) {
  const gid = String(guildId);
  const guild = registry.state.master?.client?.guilds?.cache?.get(gid);
  const chName = (id) => guild?.channels?.cache?.get(String(id))?.name || null;
  const out = [{ sel: 'all' }];
  const main = mainEntry(gid)?.voiceChannelId;
  if (main) out.push({ sel: 'main', channelId: String(main), channel: chName(main) });
  for (const s of registry.getSlaveSnapshots(gid)) {
    if (s.channelId && s.connStatus === 'ready') out.push({ sel: `room:${s.name}`, name: s.name, channelId: String(s.channelId), channel: chName(s.channelId) });
  }
  return out;
}

/** Voice channels whose people can be heard through this selection (they get the "listening" notice). */
function channelsFor(guildId, sel) {
  const list = selections(guildId);
  if (sel === 'all') return list.filter(r => r.sel.startsWith('room:')).map(r => r.channelId);
  const hit = list.find(r => r.sel === sel);
  return hit ? [hit.channelId] : [];
}

let wsSeq = 0;

function leave(ws) {
  const mix = ws._mix;
  if (!mix) return;
  ws._mix = null;
  mix.clients.delete(ws);
  if (!mix.clients.size && mixes.get(mix.key) === mix) {
    mix.relay?.stop();
    mixes.delete(mix.key);
  }
}

/** Add a WebSocket client to the guild+selection mix. ws: WsConn from wsLite. gains: null = shared mix. */
function join(ws, { guildId, sel, userId, gains = null }) {
  const gid = String(guildId);
  if (!ws._wid) ws._wid = ++wsSeq;
  const own = gains && sel !== 'main';
  const key = own ? `${gid}|${sel}|${ws._wid}` : `${gid}|${sel}`;
  let mix = mixes.get(key);
  if (!mix) {
    mix = { key, gid, sel, relay: sel === 'main' ? null : new WebRelay(own ? gains : null), clients: new Set(), out: [], nIn: 0, nBot: 0, nSent: 0, members: '', spk: '' };
    mix.relay?.start();
    mixes.set(key, mix);
  }
  ws.userId = String(userId);
  ws._join = { guildId: gid, sel, userId };
  ws._mix = mix;
  mix.clients.add(ws);
  if (!timer) { nextAt = Date.now(); timer = setTimeout(tick, 20); }
  if (!ws._wmBound) {
    ws._wmBound = true;
    ws.on('close', () => leave(ws));
  }
}

/** Listener changed their own volumes: move them to a private mix (or back to the shared one). */
function setGains(ws, gains) {
  if (!ws._join || ws.closed) return;
  if (ws._mix?.relay && gains && ws._mix.key.split('|').length === 3) { ws._mix.relay.gains = gains; return; }
  const opts = ws._join;
  leave(ws);
  join(ws, { ...opts, gains });
}

/** People who can be heard through this selection: [{ id, name, avatar, room }]. */
function members(guildId, sel) {
  const gid = String(guildId);
  const out = [];
  const seen = new Set();
  for (const e of registry.state.slaves.values()) {
    if (String(e?.cfg?.guildId) !== gid) continue;
    const room = String(e.name ?? e.cfg.name);
    if (sel !== 'all' && sel !== `room:${room}`) continue;
    for (const m of registry.roomMembers(e)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, name: m.name, avatar: m.avatar, room });
    }
  }
  return out.slice(0, 100);
}

// Keep each listener's member list fresh (only sent when it changed).
setInterval(() => {
  for (const mix of mixes.values()) {
    if (mix.sel === 'main') continue;
    const list = members(mix.gid, mix.sel);
    const json = JSON.stringify(list);
    if (json === mix.members) continue;
    mix.members = json;
    const msg = JSON.stringify({ members: list });
    for (const c of mix.clients) c.sendText?.(msg);
  }
}, 5000).unref();

/** Listeners per guild: { guildId: n }. */
function counts() {
  const out = {};
  for (const m of mixes.values()) out[m.gid] = (out[m.gid] || 0) + m.clients.size;
  return out;
}

/** Guild ids that have web listeners right now. */
function activeGuilds() {
  return [...new Set([...mixes.values()].map(m => m.gid))];
}

module.exports = { check, join, selections, channelsFor, counts, total, activeGuilds, setGains, members };
