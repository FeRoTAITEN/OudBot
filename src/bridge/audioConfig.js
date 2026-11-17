// audioConfig.js – bridge quality / stability (env overrides)

const FRAME_MS = 20;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;

function intEnv(name, fallback, min, max) {
  const n = parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Frames each source pre-buffers before it starts emitting (~20ms each).
 * Bigger = smoother under network jitter, slightly more latency.
 */
const MIN_BUFFER = intEnv('BRIDGE_MIN_BUFFER', 5, 2, 20);
const MIN_BUFFER_MUSIC = intEnv('BRIDGE_MIN_BUFFER_MUSIC', 10, 4, 25);

/** Max queued frames per source; runaway buffers get trimmed back to TARGET. */
const MAX_BUFFER = intEnv('BRIDGE_MAX_BUFFER', 50, 10, 120);

/** Level to trim to when MAX is exceeded (keeps latency bounded). */
const TARGET_BUFFER = intEnv('BRIDGE_TARGET_BUFFER', 14, 3, 80);

/**
 * Per-speaker on master: how many 20ms ticks a brief gap is concealed before a
 * clean re-prime. During this window playback resumes INSTANTLY when a frame
 * arrives — so normal network jitter mid-speech never causes a silence cut.
 * Bigger = fewer cuts under jitter, a touch more concealment on long drops.
 */
const UNDERRUN_HOLD = intEnv('BRIDGE_UNDERRUN_HOLD', 10, 0, 40);
const UNDERRUN_HOLD_MUSIC = intEnv('BRIDGE_UNDERRUN_HOLD_MUSIC', 12, 0, 40);

/**
 * Frames to re-buffer when resuming AFTER a long pause (real end of speech).
 * Smaller than MIN_BUFFER so phrase starts feel snappy while keeping a cushion.
 */
const RESUME_BUFFER = intEnv('BRIDGE_RESUME_BUFFER', 5, 1, 20);

/**
 * T42g: after a mid-speech underrun, keep concealing until this many frames are queued again,
 * so playback resumes with a cushion instead of cutting again on the next jitter spike.
 */
const REBUILD_FRAMES = intEnv('BRIDGE_REBUILD', 3, 1, 10);
const ADAPT_MAX = intEnv('BRIDGE_ADAPT_MAX', 4, 0, 10);
const ADAPT_DECAY_TICKS = intEnv('BRIDGE_ADAPT_DECAY', 750, 50, 5000);

/** Ms without input before a source is dropped from the active set. */
const SOURCE_IDLE_MS = intEnv('BRIDGE_SOURCE_IDLE_MS', 8000, 2000, 20000);

/** Inject Opus silence each tick when idle (keeps the AudioPlayer alive). */
const INJECT_SILENCE = intEnv('BRIDGE_INJECT_SILENCE', 1, 0, 1) === 1;

/** Legacy comfort knobs (kept for compatibility with old configs). */
const IDLE_MS = intEnv('BRIDGE_IDLE_MS', 800, 80, 3000);
const RX_SILENCE_MS = intEnv('BRIDGE_RX_SILENCE_MS', 2000, 800, 4000);

/** Opus encoder bitrate (stereo). Discord voice supports up to 256k. */
const OPUS_BITRATE = intEnv('BRIDGE_OPUS_BITRATE', 128000, 64000, 256000);

/** Encoder complexity 0–10 (higher = better quality, more CPU). */
const OPUS_COMPLEXITY = intEnv('BRIDGE_OPUS_COMPLEXITY', 8, 5, 10);

/** Expected packet loss for encoder FEC (percent). */
const OPUS_PACKET_LOSS = intEnv('BRIDGE_OPUS_PACKET_LOSS', 5, 0, 30);

/** Silence padding frames on the master AudioResource (kept small; relay self-pads). */
const SILENCE_PADDING_FRAMES = intEnv('BRIDGE_SILENCE_PADDING', 3, 0, 30);

module.exports = {
  FRAME_MS,
  SAMPLE_RATE,
  CHANNELS,
  MIN_BUFFER,
  MIN_BUFFER_MUSIC,
  MAX_BUFFER,
  TARGET_BUFFER,
  SOURCE_IDLE_MS,
  INJECT_SILENCE,
  IDLE_MS,
  RX_SILENCE_MS,
  OPUS_BITRATE,
  OPUS_COMPLEXITY,
  OPUS_PACKET_LOSS,
  SILENCE_PADDING_FRAMES,
  UNDERRUN_HOLD,
  UNDERRUN_HOLD_MUSIC,
  RESUME_BUFFER,
  REBUILD_FRAMES,
  ADAPT_MAX,
  ADAPT_DECAY_TICKS,
};
