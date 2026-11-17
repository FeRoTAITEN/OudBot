// opusSplit.js – T42d: Discord clients may send 10/40/60 ms Opus packets; the bridge works in 20 ms slots.
// 20 ms packets pass through untouched; others are decoded and re-encoded as 20 ms frames.
const { OpusEncoder } = require('@discordjs/opus');

const PCM_20MS = 3840; // 960 samples * 2 ch * 2 bytes

/** Duration of one Opus packet in ms from its TOC byte (RFC 6716 3.1). 0 = unknown. */
function packetMs(p) {
  if (!p || p.length < 1) return 0;
  const toc = p[0];
  const cfg = toc >> 3;
  const code = toc & 3;
  let size;
  if (cfg < 12) size = [10, 20, 40, 60][cfg & 3];
  else if (cfg < 16) size = [10, 20][cfg & 1];
  else size = [2.5, 5, 10, 20][cfg & 3];
  let n = 1;
  if (code === 1 || code === 2) n = 2;
  else if (code === 3) n = p.length > 1 ? (p[1] & 0x3f) : 0;
  return size * n;
}

class OpusSplitter {
  constructor() {
    this.codec = null;
    this.rest = null;
  }

  /** Returns an array of 20 ms Opus frames for one received packet. */
  split(p) {
    const ms = packetMs(p);
    if (ms === 20 || ms === 0) { this.rest = null; return [p]; }
    if (!this.codec) this.codec = new OpusEncoder(48000, 2);
    let pcm;
    try { pcm = this.codec.decode(p); } catch { return []; }
    if (this.rest) { pcm = Buffer.concat([this.rest, pcm]); this.rest = null; }
    const out = [];
    let o = 0;
    for (; o + PCM_20MS <= pcm.length; o += PCM_20MS) {
      try { out.push(this.codec.encode(pcm.subarray(o, o + PCM_20MS))); } catch { /* skip */ }
    }
    if (o < pcm.length) this.rest = Buffer.from(pcm.subarray(o));
    return out;
  }
}

module.exports = { packetMs, OpusSplitter };
