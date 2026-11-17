// emptyRoom.js – T61 (review M3): music does not play to an empty room forever.
// Nobody in the room (and no web/guest listener on that server) for EMPTY_PAUSE_MS -> pause, one message.
// Someone joins -> resume. Still empty after AUTODJ_OFF_MS -> Auto-DJ off.
'use strict';
const { AudioPlayerStatus } = require('@discordjs/voice');

const EMPTY_PAUSE_MS = Math.max(30_000, parseInt(process.env.EMPTY_ROOM_PAUSE_MS || '120000', 10) || 120_000);
const AUTODJ_OFF_MS = Math.max(EMPTY_PAUSE_MS, parseInt(process.env.EMPTY_ROOM_AUTODJ_OFF_MS || '1800000', 10) || 1_800_000);
const SWEEP_MS = 30_000;

function humansIn(queue) {
  const ch = queue.guild?.channels?.cache?.get(queue.voiceChannelId);
  if (!ch?.members) return null; // unknown: do nothing
  return [...ch.members.values()].filter(m => !m.user?.bot).length;
}

function webListening(guildId) {
  try { return require('../web/webMix').activeGuilds().includes(String(guildId)); } catch { return false; }
}

/** Server setting (dashboard / Discord panel); on by default. */
function pauseWhenEmpty(guildId) {
  try { return require('../web/guildPerms').get(guildId).pauseWhenEmpty !== false; } catch { return true; }
}

function pauseQueue(queue) {
  queue.player.pause();
  if (queue.current) queue.current.pausedAt = Date.now();
  queue._autoPaused = true;
}

function resumeQueue(queue) {
  queue._autoPaused = false;
  if (queue.current?.pausedAt) {
    queue.current.startedAt += Date.now() - queue.current.pausedAt;
    queue.current.pausedAt = null;
  }
  queue.player?.unpause();
}

/** One pass over one queue. Returns what it did (for tests/logs). */
function checkQueue(queueKey, queue, { now = Date.now(), t = (k) => k } = {}) {
  if (!queue?.player || !queue.voiceChannelId || !queue.guild) return null;
  const humans = humansIn(queue);
  if (humans == null) return null;
  const empty = humans === 0 && !webListening(queue.guild.id);

  if (!empty) {
    queue._emptySince = null;
    if (queue._autoPaused) {
      if (queue.player.state?.status === AudioPlayerStatus.Paused) resumeQueue(queue);
      else queue._autoPaused = false;
      console.log(`[MUSIC:${queueKey}] Someone is back — resumed`);
      return 'resumed';
    }
    return null;
  }

  const active = Boolean(queue.current) || Boolean(queue.autoDj?.enabled);
  if (!active) { queue._emptySince = null; return null; }
  if (!queue._emptySince) { queue._emptySince = now; return null; }
  const emptyFor = now - queue._emptySince;

  if (queue.autoDj?.enabled && emptyFor >= AUTODJ_OFF_MS) {
    queue.autoDj.enabled = false;
    console.log(`[MUSIC:${queueKey}] Room empty ${Math.round(emptyFor / 60000)} min — Auto-DJ off`);
    return 'autodj-off';
  }
  if (!queue._autoPaused && emptyFor >= EMPTY_PAUSE_MS && queue.player.state?.status === AudioPlayerStatus.Playing
    && pauseWhenEmpty(queue.guild.id)) {
    pauseQueue(queue);
    console.log(`[MUSIC:${queueKey}] Room empty ${Math.round(emptyFor / 1000)}s — paused`);
    queue.textChannel?.send?.(t('music.emptyPaused'))?.catch?.(() => {});
    return 'paused';
  }
  return null;
}

let timer = null;
function start(MusicManager, queues) {
  if (timer) return;
  timer = setInterval(() => {
    for (const [key, queue] of queues) {
      try {
        const { runWithLocale, t } = require('../i18n/context');
        const lang = String(queue.guild?.preferredLocale || '').startsWith('ar') ? 'ar' : 'en';
        runWithLocale(lang, () => checkQueue(key, queue, { t }));
      } catch (err) {
        console.warn(`[MUSIC:${key}] Empty-room check failed: ${err.message}`);
      }
    }
  }, SWEEP_MS);
  timer.unref?.();
}

/** A person joined the room: resume right away instead of waiting for the next pass. */
function onJoin(queueKey, queue) {
  queue._emptySince = null;
  if (queue._autoPaused && queue.player?.state?.status === AudioPlayerStatus.Paused) {
    resumeQueue(queue);
    console.log(`[MUSIC:${queueKey}] Someone joined — resumed`);
  }
}

module.exports = { start, checkQueue, onJoin, EMPTY_PAUSE_MS, AUTODJ_OFF_MS };
