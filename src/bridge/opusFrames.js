// opusFrames.js – detect Discord/Opus comfort-noise (sounds hollow if relayed)

const OPUS_SILENCE = Buffer.from([0xf8, 0xff, 0xfe]);

function isOpusComfortNoise(frame) {
  if (!frame?.length) return true;
  if (frame.length === OPUS_SILENCE.length && frame.equals(OPUS_SILENCE)) return true;
  if (frame.length <= 3 && frame[0] === 0xf8) return true;
  return false;
}

module.exports = { isOpusComfortNoise, OPUS_SILENCE };
