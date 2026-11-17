// relayStream.js – fixed-cadence 20ms output (always-on, never EOFs)
// Each speaker has its own bucket (room:userId). One active = Opus passthrough.
// Multiple active: per-user decode, PCM mix, single encode.
// Idle: emits Opus comfort-noise so the AudioPlayer never goes Idle (no cuts).
const { Readable } = require('stream');
const { OpusEncoder } = require('@discordjs/opus');
const registry = require('./registry');
const { isOpusComfortNoise, OPUS_SILENCE } = require('./opusFrames');
const {
  FRAME_MS,
  SAMPLE_RATE,
  CHANNELS,
  MIN_BUFFER,
  MIN_BUFFER_MUSIC,
  MAX_BUFFER,
  TARGET_BUFFER,
  SOURCE_IDLE_MS,
  OPUS_BITRATE,
  OPUS_COMPLEXITY,
  OPUS_PACKET_LOSS,
  UNDERRUN_HOLD,
  UNDERRUN_HOLD_MUSIC,
  RESUME_BUFFER,
  REBUILD_FRAMES,
  ADAPT_MAX,
  ADAPT_DECAY_TICKS,
} = require('./audioConfig');
const { resolveSlaveRoom } = require('./sourceKey');

const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;
const PCM_FRAME_BYTES = SAMPLES_PER_FRAME * CHANNELS * 2;

// Ticks we actually repeat the last waveform (faded). Beyond this we hold
// silence so we never loop one 20ms frame long enough to buzz.
const CONCEAL_FADE_TICKS = 4;

// libopus CTL request codes (see opus_defines.h).
const OPUS_SET_COMPLEXITY = 4010;
const OPUS_SET_INBAND_FEC = 4012;
const OPUS_SET_PACKET_LOSS_PERC = 4014;
const OPUS_SET_SIGNAL = 4024;
const OPUS_AUTO = -1000;

// Max frames produced in a single timer fire when refilling the cushion after
// we've fallen behind. Caps the burst (and guards the refill loop).
const MAX_CATCHUP_TICKS = 5;
// Target depth of the object-mode output buffer (in frames). The AudioPlayer
// polls on its own 20ms timer at an arbitrary phase; this cushion absorbs that
// phase drift and brief event-loop jitter so a read never finds an empty buffer
// (which would cause a silence-padding micro-cut). 3 frames ≈ 60ms.
// Linux timers are precise (bridge-bench: loop p99 ~2 ms), so 3 frames is enough and saves 40 ms latency.
const READABLE_LEAD_FRAMES = Math.max(2, Math.min(8, parseInt(process.env.BRIDGE_READABLE_LEAD || '3', 10) || 3));

function configureOpusEncoder(enc) {
  try {
    enc.setBitrate(OPUS_BITRATE);
    enc.applyEncoderCTL(OPUS_SET_COMPLEXITY, OPUS_COMPLEXITY);
    enc.applyEncoderCTL(OPUS_SET_INBAND_FEC, 1);
    enc.applyEncoderCTL(OPUS_SET_PACKET_LOSS_PERC, OPUS_PACKET_LOSS);
    // AUTO: let libopus pick voice/music mode — forcing VOICE degrades music.
    enc.applyEncoderCTL(OPUS_SET_SIGNAL, OPUS_AUTO);
  } catch { /* non-fatal */ }
}

class RelayStream extends Readable {
  constructor() {
    // OBJECT MODE is mandatory: @discordjs/voice reads exactly one packet per
    // 20ms via playStream.read(). A byte-mode stream would return ALL buffered
    // bytes at once, gluing several Opus frames into one packet — the player
    // then ships malformed multi-frame packets and only the first ~20ms decodes
    // on the receiver (that was the real, constant "choppiness"). In object mode
    // each push() is one frame and each read() returns exactly one frame.
    // highWaterMark is counted in frames here (~5s of audio).
    super({ objectMode: true, highWaterMark: 256 });
    this._sources = new Map();
    this._codecs = new Map();
    this._outEncoder = new OpusEncoder(SAMPLE_RATE, CHANNELS);
    configureOpusEncoder(this._outEncoder);
    this._tickTimer = null;
    this._nextTickAt = 0;
    this._stopped = false;
    this._tickN = 0;
    this.diag = { ticks: 0, voiced: 0, silent: 0, conceal: 0, starve: 0, catchup: 0, late: 0, cut: 0 };
  }

  start() {
    if (this._tickTimer || this._stopped) return;
    // Pre-seed the outgoing Readable buffer with a few silence frames so the
    // AudioPlayer's poll never starves at startup (or when phase drifts).
    for (let i = 0; i < READABLE_LEAD_FRAMES; i++) {
      if (this.readableEnded) break;
      this.push(OPUS_SILENCE);
    }
    this._nextTickAt = Date.now() + FRAME_MS;
    this._scheduleNext();
  }

  _scheduleNext() {
    if (this._stopped) return;
    const delay = Math.max(0, this._nextTickAt - Date.now());
    this._tickTimer = setTimeout(() => this._runTick(), delay);
  }

  _runTick() {
    if (this._stopped) return;
    if (Date.now() - this._nextTickAt > 40) this.diag.late++;
    if (this.readableLength === 0) this.diag.starve++;
    let ran = 0;
    // Adaptive rate-match against the consumer (the AudioPlayer reads exactly
    // one frame per 20ms). Each timer fire we top the object-mode output buffer
    // back up to the cushion target — pushing 0 when we're ahead (no latency
    // creep) and a small burst when we've fallen behind (no starvation). This
    // self-corrects timer drift in BOTH directions without ever gluing frames.
    let budget = MAX_CATCHUP_TICKS;
    while (budget-- > 0 && !this._stopped && this.readableLength < READABLE_LEAD_FRAMES) {
      ran++;
      this._tick();
    }
    if (ran > 1) this.diag.catchup++;
    this._nextTickAt += FRAME_MS;
    if (this._nextTickAt < Date.now()) {
      // Resync to wall clock after a stall instead of replaying missed ticks.
      this._nextTickAt = Date.now() + FRAME_MS;
    }
    this._scheduleNext();
  }

  addFrame(frame, source = 'default') {
    if (this._stopped) return;
    if (!frame?.length) return;

    const name = String(source);
    const bucket = this._getBucket(name);
    // Comfort-noise marks "end of speech" — refresh activity but don't queue.
    // Relaying them sounds hollow / clicky on the master side.
    bucket.lastIn = Date.now();
    if (isOpusComfortNoise(frame)) return;
    bucket.frames.push(frame);
    // Trim runaway latency: cap buffer and drop oldest down to TARGET_BUFFER.
    if (bucket.frames.length > MAX_BUFFER) {
      bucket.frames.splice(0, bucket.frames.length - TARGET_BUFFER);
    }
  }

  _getBucket(name) {
    let b = this._sources.get(name);
    if (!b) {
      b = {
        frames: [],
        lastIn: 0,
        source: name,
        priming: true,
        primeNeed: null,
        lastPcm: null,
        lastOpus: null,
        concealTicks: 0,
        extra: 0,
        lastCut: 0,
      };
      this._sources.set(name, b);
    }
    return b;
  }

  _unmutedSources(now = Date.now()) {
    const out = [];
    for (const [name, b] of this._sources) {
      if (registry.isBridgeMuted(name)) continue;
      if (now - b.lastIn > SOURCE_IDLE_MS) continue;
      out.push(name);
    }
    return out;
  }

  _prune(now) {
    for (const [name, bucket] of this._sources) {
      if (now - bucket.lastIn > SOURCE_IDLE_MS) {
        bucket.frames.length = 0;
        this._sources.delete(name);
        this._codecs.delete(name);
      }
    }
  }

  _getCodec(source) {
    if (!this._codecs.has(source)) {
      const enc = new OpusEncoder(SAMPLE_RATE, CHANNELS);
      configureOpusEncoder(enc);
      this._codecs.set(source, enc);
    }
    return this._codecs.get(source);
  }

  /** Gain for a source (admin volume). WebRelay multiplies in the listener's own volumes. */
  _gainFor(source) {
    return registry.getVolume(source);
  }

  _applyGainPcm(pcm, gain) {
    if (Math.abs(gain - 1) < 0.001) return pcm;
    if (pcm.byteOffset & 1) pcm = Buffer.from(pcm);
    const out = Buffer.allocUnsafe(pcm.length);
    const src = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
    const dst = new Int16Array(out.buffer, out.byteOffset, out.length >> 1);
    for (let i = 0; i < src.length; i++) {
      const s = src[i] * gain;
      dst[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
    }
    return out;
  }

  _pushSilence() {
    if (this._stopped || this.readableEnded) return;
    this.push(OPUS_SILENCE);
  }

  _pushOpus(opus, source) {
    if (this._stopped || this.readableEnded) return;
    const gain = this._gainFor(source);
    try {
      if (Math.abs(gain - 1) < 0.001) {
        this.push(opus);
      } else {
        const pcm = this._applyGainPcm(this._getCodec(source).decode(opus), gain);
        this.push(this._outEncoder.encode(pcm));
      }
    } catch {
      this._pushSilence();
    }
  }

  // Per-user pull: fresh Opus passthrough when possible.
  //
  // On underrun we DON'T immediately re-prime (that forced a ~MIN_BUFFER silence
  // gap — the audible cut). Instead we conceal: fade the last frame out over a
  // few ticks, then hold silence, while keeping the source "live" so the very
  // next arriving frame plays INSTANTLY. Only after a sustained gap (real end of
  // speech, where no audio is lost) do we re-prime for a clean phrase restart.
  _pullSample(bucket, codec, needPcm = true) {
    const minBuf = this._minBufferFor(bucket.source);
    const holdMax = this._holdTicksFor(bucket.source);

    if (bucket.priming) {
      const need = bucket.primeNeed ?? minBuf;
      if (bucket.frames.length >= need) {
        bucket.priming = false;
        bucket.primeNeed = null;
      } else {
        return null;
      }
    }

    // T42g: inside an underrun, wait for a small cushion before resuming.
    if (bucket.extra > 0 && this._tickN - bucket.lastCut > ADAPT_DECAY_TICKS) { bucket.extra--; bucket.lastCut = this._tickN; }
    const rebuilding = bucket.concealTicks > 0 && bucket.frames.length < REBUILD_FRAMES + bucket.extra;
    const opus = rebuilding ? undefined : bucket.frames.shift();
    if (opus) {
      if (bucket.concealTicks > 0) {
        this.diag.cut++;
        // T46: this speaker's network is jittery: keep a bigger cushion for a while.
        if (bucket.extra < ADAPT_MAX) bucket.extra++;
        bucket.lastCut = this._tickN;
      }
      bucket.concealTicks = 0;
      bucket.lastOpus = opus;
      if (!needPcm) {
        bucket.lastPcm = null;
        return { opus, pcm: null, fresh: true };
      }
      try {
        bucket.lastPcm = codec.decode(opus);
        return { opus, pcm: bucket.lastPcm, fresh: true };
      } catch {
        return null;
      }
    }

    // Concealment needs the last waveform: decode it now if passthrough skipped it.
    if (!bucket.lastPcm && bucket.lastOpus && bucket.concealTicks < this._holdTicksFor(bucket.source)) {
      try { bucket.lastPcm = codec.decode(bucket.lastOpus); } catch { bucket.lastOpus = null; }
    }

    // Underrun inside the conceal window: keep the source live (instant resume).
    if (bucket.lastPcm && bucket.concealTicks < holdMax) {
      this.diag.conceal++;
      bucket.concealTicks++;
      const fadeTicks = Math.min(holdMax, CONCEAL_FADE_TICKS);
      if (bucket.concealTicks <= fadeTicks) {
        const fade = 1 - bucket.concealTicks / (fadeTicks + 1);
        return { opus: null, pcm: this._applyGainPcm(bucket.lastPcm, fade), fresh: false };
      }
      // Faded out — hold silence but stay live so a returning frame resumes now.
      return { opus: null, pcm: null, fresh: false, silence: true };
    }

    // Sustained gap → genuine end of speech. Re-prime with a small cushion so
    // the next phrase restarts smoothly (no audio is lost: the source is silent).
    bucket.priming = true;
    bucket.primeNeed = Math.min(minBuf, RESUME_BUFFER) + bucket.extra;
    bucket.lastPcm = null;
    bucket.lastOpus = null;
    bucket.concealTicks = 0;
    return null;
  }

  _pushPcm(pcm) {
    if (this._stopped || this.readableEnded || !pcm) return;
    try {
      this.push(this._outEncoder.encode(pcm));
    } catch {
      this._pushSilence();
    }
  }

  _roomHasMusic(source) {
    return registry.isSlaveMusicActiveForSource(source);
  }

  _minBufferFor(source) {
    return this._roomHasMusic(source) ? MIN_BUFFER_MUSIC : MIN_BUFFER;
  }

  _holdTicksFor(source) {
    return this._roomHasMusic(source) ? UNDERRUN_HOLD_MUSIC : UNDERRUN_HOLD;
  }

  _tick() {
    if (this._stopped || this.readableEnded) return;
    const now = Date.now();
    this._prune(now);

    const active = this._unmutedSources(now);
    this.diag.ticks++;
    this._tickN++;
    if (active.length) this.diag.voiced++;

    if (active.length === 0) {
      this._pushSilence();
      return;
    }

    if (active.length === 1) {
      const bucket = this._sources.get(active[0]);
      const codec = this._getCodec(bucket.source);
      const gain = this._gainFor(bucket.source);
      const passthrough = Math.abs(gain - 1) < 0.001;
      const sample = this._pullSample(bucket, codec, !passthrough);
      if (!sample || sample.silence || (!sample.pcm && !(sample.fresh && sample.opus))) {
        if (active.length) this.diag.silent++;
        this._pushSilence();
        return;
      }
      if (sample.fresh && Math.abs(gain - 1) < 0.001) {
        this.push(sample.opus);
      } else {
        this._pushPcm(this._applyGainPcm(sample.pcm, gain));
      }
      return;
    }

    // Multi-source: per-user PCM, sum, encode once.
    const mixed = Buffer.alloc(PCM_FRAME_BYTES);
    const mix = new Int16Array(mixed.buffer, mixed.byteOffset, mixed.length >> 1);
    let mixedAny = false;

    for (const name of active) {
      const bucket = this._sources.get(name);
      if (!bucket) continue;
      const sample = this._pullSample(bucket, this._getCodec(name));
      if (!sample?.pcm || sample.pcm.length < 4) continue;

      const scaled = this._applyGainPcm(sample.pcm, this._gainFor(name));
      const al = scaled.byteOffset & 1 ? Buffer.from(scaled) : scaled;
      const src = new Int16Array(al.buffer, al.byteOffset, al.length >> 1);
      const samples = Math.min(src.length, mix.length);
      for (let i = 0; i < samples; i++) {
        const v = mix[i] + src[i];
        mix[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
      }
      mixedAny = true;
    }

    if (!mixedAny) {
      this._pushSilence();
      return;
    }
    try {
      this.push(this._outEncoder.encode(mixed));
    } catch {
      this._pushSilence();
    }
  }

  _read() { /* push-driven */ }

  stop() {
    if (this._stopped) return;
    this._stopped = true;
    if (this._tickTimer) {
      clearTimeout(this._tickTimer);
      this._tickTimer = null;
    }
    this._sources.clear();
    this._codecs.clear();
    if (!this.readableEnded) this.push(null);
  }
}

module.exports = { RelayStream };
