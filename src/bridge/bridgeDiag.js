// bridgeDiag.js – T42c: every 30 s, one line per guild with bridge audio or web listeners:
// relay health (starve = player found no frame -> audible gap), capture counts per room, event-loop lag.
const { monitorEventLoopDelay } = require('perf_hooks');
const bridge = require('./bridge');
const registry = require('./registry');

const loop = monitorEventLoopDelay({ resolution: 10 });
loop.enable();
const last = new Map(); // gid -> last 30 s report (T50: dashboard audio health)
const webStat = new Map(); // gid -> { under, drop, n } from web listeners' own reports
function noteWeb(gid, under, drop) {
  const w = webStat.get(gid) || { under: 0, drop: 0, n: 0 };
  w.under += under; w.drop += drop; w.n++;
  webStat.set(gid, w);
}

// T56: raw UDP tap before @discordjs/voice filters packets (it ignores non-Opus payload types
// before parsePacket, which shows up as RTP sequence gaps in the 'lost' counter).
function tapUdp(e) {
  const sock = e.connection?.state?.networking?.state?.udp?.socket;
  if (!sock || sock._oudTap) return;
  sock._oudTap = true;
  const seqs = new Map();
  sock.on('message', (msg) => {
    if (msg.length <= 12) return;
    const ssrc = msg.readUInt32BE(8);
    if (!e.connection?.receiver?.ssrcMap?.get?.(ssrc)) return;
    const t = e.rawDiag || (e.rawDiag = { n: 0, gap: 0, pt: {}, by: {} });
    const pt = msg[1] & 127;
    t.n++; t.pt[pt] = (t.pt[pt] || 0) + 1;
    const seq = msg.readUInt16BE(2); const last = seqs.get(ssrc);
    const u = String(e.connection.receiver.ssrcMap.get(ssrc).userId).slice(-4);
    const b = t.by[u] || (t.by[u] = { n: 0, gap: 0 });
    b.n++;
    if (last !== undefined) { const g = (seq - last - 1) & 0xffff; if (g > 0 && g < 500) { t.gap += g; b.gap += g; } }
    seqs.set(ssrc, seq);
  });
}

function roomsOf(gid) {
  const out = [];
  for (const e of registry.state.slaves.values()) {
    if (String(e?.cfg?.guildId) !== gid) continue;
    const st = e.connection?.state?.status || 'none';
    const spk = e.connection?.receiver?.speaking?.users?.size ?? 0;
    const d = e.diag;
    try { tapUdp(e); } catch { /* diag only */ }
    const t = e.rawDiag; e.rawDiag = null;
    const raw = t ? ` raw=${t.n} rawgap=${t.gap} pt=${Object.entries(t.pt).map(([k, v]) => `${k}:${v}`).join(',')} by=${Object.entries(t.by).map(([k, v]) => `${k}:${v.n}/${v.gap}`).join(',')}` : '';
    out.push({ name: String(e.name), lost: d?.lost || 0, drop: d?.drop || 0, busy: Boolean(d && (d.rx || d.out)), text: d
      ? `${e.name}(${st} subs=${d.users.size} spk=${spk} rx=${d.rx} cn=${d.cn} out=${d.out} err=${d.err} long=${d.long || 0} short=${d.short || 0} udp=${d.udp || 0} lost=${d.lost || 0} drop=${d.drop || 0} bad=${d.bad || 0}${raw})`
      : `${e.name}(${st} spk=${spk} no-capture)` });
    if (d) { d.rx = 0; d.cn = 0; d.out = 0; d.err = 0; d.long = 0; d.short = 0; d.udp = 0; d.lost = 0; d.drop = 0; d.bad = 0; }
  }
  return out;
}

function report() {
  const lag99 = Math.round(loop.percentile(99) / 1e6);
  const lag = `lag p99=${lag99}ms max=${Math.round(loop.max / 1e6)}ms`;
  loop.reset();
  let web = [];
  try { web = require('../web/webMix').activeGuilds(); } catch { /* web off */ }
  const relays = new Map(bridge.listGuildRelays().map(([g, r]) => [String(g), r]));
  const gids = new Set([...relays.keys(), ...web.map(String)]);
  for (const gid of gids) {
    const r = relays.get(gid);
    const d = r?.diag;
    const rooms = roomsOf(gid);
    const voiced = d ? d.voiced : 0;
    if (!voiced && !rooms.some(x => x.busy) && !web.includes(gid)) { if (d) for (const k of Object.keys(d)) d[k] = 0; continue; }
    const relay = d
      ? `relay ticks=${d.ticks} voiced=${d.voiced} silent=${d.silent} conceal=${d.conceal} starve=${d.starve} catchup=${d.catchup} late=${d.late} cut=${d.cut}`
      : 'relay none';
    console.log(`[BRIDGEDIAG] g=${gid} ${relay} ${lag} | ${rooms.map(x => x.text).join(' ') || 'no rooms'}`);
    last.set(gid, { gid, at: Date.now(), voiced, cut: d?.cut || 0, conceal: d?.conceal || 0, starve: d?.starve || 0, lag99, rooms: rooms.map(x => ({ name: x.name, lost: x.lost, drop: x.drop })), web: webStat.get(gid) || null });
    if (d) for (const k of Object.keys(d)) d[k] = 0;
  }
  webStat.clear();
}

if (process.env.BRIDGE_DIAG !== '0') setInterval(report, 30000).unref();

/** Reports from the last 90 s, one per guild. */
function snapshot() {
  const now = Date.now();
  return [...last.values()].filter(s => now - s.at < 90000);
}

module.exports = { report, snapshot, noteWeb };
