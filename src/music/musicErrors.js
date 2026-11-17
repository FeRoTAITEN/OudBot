const { t, getLang } = require('../i18n/context');
const { playCommand } = require('../i18n');
const { createLogger } = require('../util/logger');

const musicLog = createLogger('MUSIC');

function cmd() {
  return playCommand(getLang());
}

function extractMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

function formatMusicError(err, context = 'search') {
  const raw = extractMessage(err);
  const lower = raw.toLowerCase();

  if (lower.includes('playlist error')) {
    const detail = raw.replace(/^playlist error:\s*/i, '').trim();
    if (lower.includes('unviewable')) {
      return formatMixPlaylistError(false);
    }
    if (lower.includes('not found')) {
      return t('err.plNotFound');
    }
    return t('err.plError', { detail: detail || t('err.plDetail') });
  }

  if (lower.includes('failed to parse ytinitialdata')) {
    return t('err.ytUnavailable');
  }

  if (lower.includes('no results') || lower.includes('no videos')) {
    return t('err.noResults');
  }

  if (lower.includes('private video') || lower.includes('unavailable')) {
    return t('err.videoUnavailable');
  }

  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset')) {
    return t('err.timeout');
  }

  if (lower.includes('eai_again') || lower.includes('enotfound') || lower.includes('getaddrinfo')) {
    return t('err.timeout');
  }

  if (lower.includes('music slot wait timeout')) {
    return t('err.playback');
  }

  if (/yt-dlp|youtube-dl|requested format is not available|sign in to confirm/i.test(lower)) {
    return t('err.playback');
  }

  if (context === 'playback') {
    return t('err.playback');
  }

  if (context === 'playlist') {
    return t('err.playlistLoad');
  }

  return t('err.search');
}

function formatMixPlaylistError(hasVideo = false) {
  let msg = t('err.mix');
  if (hasVideo) msg += t('err.mixBelow');
  else msg += t('err.mixOr', { cmd: cmd() });
  return msg;
}

function isUnknownInteraction(err) {
  return err?.code === 10062
    || err?.rawError?.code === 10062
    || /unknown interaction/i.test(extractMessage(err));
}

function isInteractionAcknowledged(err) {
  return err?.code === 40060
    || err?.rawError?.code === 40060
    || /interaction has already been acknowledged/i.test(extractMessage(err));
}

function logMusicError(err, tag = 'music', meta = {}) {
  if (isUnknownInteraction(err) || isInteractionAcknowledged(err)) return;
  const msg = extractMessage(err);
  const parts = [`[MUSIC:${tag}]`];
  if (meta.queueKey) parts.push(`room=${meta.queueKey}`);
  if (meta.title) parts.push(`title="${String(meta.title).slice(0, 80)}"`);
  if (meta.url) parts.push(`url=${meta.url}`);
  parts.push(msg);
  musicLog.error(parts.join(' '));

  const known = /playlist error|ytinitialdata|no results|private video|timeout|econnreset|eai_again|enotfound|getaddrinfo|yt-dlp|stream retry|ffmpeg exited|music slot wait/i.test(msg);
  if (!known && err?.stack) {
    const trace = err.stack.split('\n').slice(1, 4).join('\n');
    if (trace) musicLog.error(trace);
  }
}

module.exports = {
  formatMusicError,
  formatMixPlaylistError,
  logMusicError,
  isUnknownInteraction,
  isInteractionAcknowledged,
};
