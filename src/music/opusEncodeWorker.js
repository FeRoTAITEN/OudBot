// opusEncodeWorker.js – worker thread: s16le 48k stereo PCM -> 20 ms Opus frames, with live gain.
const { parentPort } = require('worker_threads');
const { OpusEncoder } = require('@discordjs/opus');

const FRAME_BYTES = 960 * 2 * 2;
const streams = new Map(); // id -> { enc, gain, rest }

function applyGain(frame, gain) {
  if (Math.abs(gain - 1) < 0.001) return frame;
  const s = new Int16Array(frame.buffer, frame.byteOffset, frame.length / 2);
  for (let i = 0; i < s.length; i++) {
    const v = s[i] * gain;
    s[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
  return frame;
}

function encodeAll(st, buf, flush) {
  let data = st.rest.length ? Buffer.concat([st.rest, buf]) : buf;
  const out = [];
  let off = 0;
  while (data.length - off >= FRAME_BYTES) {
    const frame = Buffer.from(data.subarray(off, off + FRAME_BYTES));
    off += FRAME_BYTES;
    const opus = st.enc.encode(applyGain(frame, st.gain));
    out.push(opus.buffer.slice(opus.byteOffset, opus.byteOffset + opus.length));
  }
  data = data.subarray(off);
  if (flush && data.length) {
    const frame = Buffer.alloc(FRAME_BYTES);
    data.copy(frame);
    const opus = st.enc.encode(applyGain(frame, st.gain));
    out.push(opus.buffer.slice(opus.byteOffset, opus.byteOffset + opus.length));
    data = Buffer.alloc(0);
  }
  st.rest = Buffer.from(data);
  return out;
}

parentPort.on('message', (m) => {
  if (m.t === 'open') {
    const enc = new OpusEncoder(48000, 2);
    if (m.bitrate) { try { enc.setBitrate(m.bitrate); } catch { /* keep default */ } }
    streams.set(m.id, { enc, gain: m.gain ?? 1, rest: Buffer.alloc(0) });
    return;
  }
  const st = streams.get(m.id);
  if (!st) return;
  if (m.t === 'vol') { st.gain = m.gain; return; }
  if (m.t === 'close') { streams.delete(m.id); return; }
  if (m.t === 'pcm' || m.t === 'end') {
    let frames;
    try {
      frames = encodeAll(st, m.buf ? Buffer.from(m.buf) : Buffer.alloc(0), m.t === 'end');
    } catch (err) {
      parentPort.postMessage({ t: 'error', id: m.id, message: String(err?.message || err) });
      return;
    }
    if (m.t === 'end') streams.delete(m.id);
    parentPort.postMessage({ t: 'opus', id: m.id, frames, end: m.t === 'end' }, frames);
  }
});
