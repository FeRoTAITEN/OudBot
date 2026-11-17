// opusEncodePool.js – Opus encoding of music PCM on worker threads (keeps the voice cycle on time).
// encodeStream(pcm, gain) -> object-mode Readable of 20 ms Opus frames (use StreamType.Opus),
// with .setVolume(gain). Back-pressure flows back to the PCM pipe (pause/resume).
const path = require('path');
const { Worker } = require('worker_threads');
const { Readable } = require('stream');

const POOL_SIZE = Math.max(1, Math.min(8, parseInt(process.env.MUSIC_ENCODE_WORKERS || '3', 10) || 3));
const MAX_INFLIGHT = 4;
const workers = []; // { w, streams: Map<id, OpusPoolStream> }
let nextId = 1;

function spawn(slot) {
  const w = new Worker(path.join(__dirname, 'opusEncodeWorker.js'));
  w.unref();
  const rec = { w, streams: new Map() };
  w.on('message', (m) => rec.streams.get(m.id)?._onMessage(m));
  const fail = (err) => {
    for (const s of rec.streams.values()) s.destroy(err instanceof Error ? err : new Error('opus worker exited'));
    rec.streams.clear();
    if (workers[slot] === rec) workers[slot] = null;
  };
  w.on('error', fail);
  w.on('exit', (code) => { if (code !== 0) fail(new Error(`opus worker exited ${code}`)); else if (workers[slot] === rec) workers[slot] = null; });
  workers[slot] = rec;
  return rec;
}

function pickWorker() {
  let best = null;
  for (let i = 0; i < POOL_SIZE; i++) {
    const rec = workers[i] || spawn(i);
    if (!best || rec.streams.size < best.streams.size) best = rec;
  }
  return best;
}

class OpusPoolStream extends Readable {
  constructor(pcm, gain = 1, bitrate = 128000) {
    super({ objectMode: true, highWaterMark: 25 });
    this._id = nextId++;
    this._pcm = pcm;
    this._inflight = 0;
    this._ended = false;
    this._rec = pickWorker();
    this._rec.streams.set(this._id, this);
    this._rec.w.postMessage({ t: 'open', id: this._id, gain, bitrate });
    this._onData = (chunk) => {
      const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length);
      this._inflight++;
      this._rec.w.postMessage({ t: 'pcm', id: this._id, buf: ab }, [ab]);
      if (this._inflight >= MAX_INFLIGHT) pcm.pause();
    };
    this._onEnd = () => { this._ended = true; this._rec.w.postMessage({ t: 'end', id: this._id }); };
    this._onError = (err) => this.destroy(err);
    pcm.on('data', this._onData);
    pcm.once('end', this._onEnd);
    pcm.once('error', this._onError);
  }

  setVolume(gain) {
    if (!this.destroyed) this._rec.w.postMessage({ t: 'vol', id: this._id, gain: Number(gain) || 0 });
  }

  _onMessage(m) {
    if (this.destroyed) return;
    if (m.t === 'error') { this.destroy(new Error(`opus encode: ${m.message}`)); return; }
    if (m.t !== 'opus') return;
    let more = true;
    for (const ab of m.frames) more = this.push(Buffer.from(ab));
    if (m.end) { this._rec.streams.delete(this._id); this.push(null); return; }
    this._inflight--;
    if (!more) this._pcm.pause();
    else if (this._inflight < MAX_INFLIGHT && !this._ended) this._pcm.resume();
  }

  _read() {
    if (!this._ended && this._inflight < MAX_INFLIGHT) this._pcm.resume();
  }

  _destroy(err, cb) {
    this._pcm.off('data', this._onData);
    this._pcm.off('end', this._onEnd);
    this._pcm.off('error', this._onError);
    if (this._rec.streams.delete(this._id)) {
      try { this._rec.w.postMessage({ t: 'close', id: this._id }); } catch { /* worker gone */ }
    }
    try { this._pcm.destroy(); } catch { /* ignore */ }
    cb(err);
  }
}

function encodeStream(pcm, gain, bitrate) {
  return new OpusPoolStream(pcm, gain, bitrate);
}

module.exports = { encodeStream, OpusPoolStream };
