// jitterHub.js – per-speaker event-driven jitter buffer on SLAVE (no extra 20ms clock)
const { isOpusComfortNoise } = require('./opusFrames');

function intEnv(name, fallback, min, max) {
  const n = parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const PRIME_IDLE = intEnv('JITTER_PRIME_IDLE', 2, 0, 10);
const PRIME_MUSIC = intEnv('JITTER_PRIME_MUSIC', 4, 2, 15);
const MAX_DEPTH = intEnv('JITTER_MAX_DEPTH', 50, 15, 120);
const CATCHUP_DEPTH = intEnv('JITTER_CATCHUP_DEPTH', 6, 3, 20);
const CATCHUP_BURST = intEnv('JITTER_CATCHUP_BURST', 3, 1, 6);

class JitterHub {
  /**
   * @param {(frame: Buffer, sourceKey: string) => void} emitFn
   */
  constructor(emitFn) {
    this._emit = emitFn;
    /** @type {Map<string, { q: Buffer[], live: boolean }>} */
    this._bufs = new Map();
    this._music = false;
  }

  setMusicActive(active) {
    this._music = Boolean(active);
  }

  _primeTarget() {
    return this._music ? PRIME_MUSIC : PRIME_IDLE;
  }

  /** Discord comfort-noise between words — keep session alive, don't queue. */
  touch(sourceKey) {
    const b = this._bufs.get(sourceKey);
    if (b) b.live = true;
  }

  push(sourceKey, frame) {
    if (!frame?.length) return;

    if (isOpusComfortNoise(frame)) {
      this.touch(sourceKey);
      return;
    }

    let b = this._bufs.get(sourceKey);
    if (!b) {
      b = { q: [], live: false };
      this._bufs.set(sourceKey, b);
    }

    b.q.push(frame);
    if (b.q.length > MAX_DEPTH) {
      b.q.splice(0, b.q.length - Math.floor(MAX_DEPTH * 0.7));
    }
    this._drain(sourceKey, b);
  }

  _drain(sourceKey, b) {
    if (!b.live) {
      if (b.q.length < this._primeTarget()) return;
      b.live = true;
    }
    const burst = b.q.length >= CATCHUP_DEPTH
      ? Math.min(CATCHUP_BURST, b.q.length)
      : 1;
    for (let i = 0; i < burst && b.q.length > 0; i++) {
      this._emit(b.q.shift(), sourceKey);
    }
  }

  /** Drop a source's buffer (user left the room). */
  forget(sourceKey) {
    this._bufs.delete(sourceKey);
  }

  stop() {
    this._bufs.clear();
  }
}

module.exports = { JitterHub };
