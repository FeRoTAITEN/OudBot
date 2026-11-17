const { t, getLang } = require('../i18n/context');
const { playCommand } = require('../i18n');

function cmd() {
  return playCommand(getLang());
}

function loopModeLabel(loop) {
  if (loop === 'none') return t('mgr.loopOff');
  if (loop === 'queue') return t('mgr.loopQueue');
  return t('mgr.loopTrack');
}

const {
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const { resolveYtdlpBinary } = require('./ytdlpPath');
const ffmpegPath = require('ffmpeg-static');
const prismMedia = require('prism-media');
const { args: ytdlpArgs } = require('youtube-dl-exec');
const { ytdlpExecOptions, isYtdlp403Error, nextFallbackClient } = require('./ytdlpOptions');

if (ffmpegPath) {
  try {
    prismMedia.FFmpeg.getInfo(true);
  } catch (err) {
    console.warn('[MUSIC] FFmpeg init:', err.message);
  }
}
const yts = require('./youtubeSearch');
const playLimits = require('./playLimits');
// T61 (review M4): a queue never grows without limit (a 5,000-video playlist went into memory and every refresh).
const OWNER_ANNOUNCE_GAP_MS = 120_000;
const MAX_QUEUE = Math.max(50, parseInt(process.env.MUSIC_MAX_QUEUE || '500', 10) || 500);
const { EmbedBuilder } = require('discord.js');
const { Ephemeral } = require('../util/interactionFlags');
const { discordMessageEdit, discordMessageSend } = require('../util/discordRetry');
const { findLyrics } = require('./lyricsService');
const {
  buildNowPlayingEmbed,
  buildSearchEmbed,
  buildQueueEmbed,
  buildQueuePayload,
  buildVideoOnlyRow,
  buildHelpEmbed,
  buildSavePreviewEmbed,
  buildSavedEmbed,
  buildSaveSuccessEmbed,
  buildLoadSuccessEmbed,
  buildPlaylistDetailEmbed,
  buildControls,
  buildFinishedNowPlayingEmbed,
  buildFinishedControls,
  buildMenuPayload,
  buildSearchSelect,
  buildPlaylistManagerRows,
  buildLibraryPayload,
  buildChoosePayload,
  buildUrlChoiceEmbed,
  buildUrlChoiceRow,
  buildHistoryPlayRow,
  themeFor,
  buildPlaylistEditPayload,
  pageForTrackIndex,
  TRACK_REMOVE_PAGE_SIZE,
  buildDeleteConfirmRow,
  buildClearConfirmRow,
  buildHistoryEmbed,
  buildStatsEmbed,
  buildClearHistoryConfirmRow,
  AUTO_DJ_MOODS,
  buildTransferSelectRow,
  parseMusicId,
  formatDuration,
  addedQueueText,
  getTrackElapsed,
  FILTER_PRESETS,
  SEARCH_RESULT_LIMIT,
  filterLabel,
} = require('./musicUI');

function moodLabelFromId(moodId) {
  const preset = AUTO_DJ_MOODS.find(m => m.id === moodId);
  return preset ? t(`music.mood.${preset.key}`) : moodId;
}

function isMusicMenuMessage(interaction) {
  const title = interaction.message?.embeds?.[0]?.title ?? '';
  return title.includes('Music Menu') || title.includes('قائمة الموسيقى');
}
const playlistStore = require('./playlistStore');
const { resolveGuildId } = require('../config/channels');
const { isGuildBridgeRuntime } = require('../config/mode');
const { musicQueueKeyMatches } = require('./queueKey');
const { parseSlaveQueueKey } = require('./slaveQueueKey');
const historyStore = require('./historyStore');
const djStatsStore = require('./djStatsStore');
const {
  formatMusicError,
  formatMixPlaylistError,
  logMusicError,
  isUnknownInteraction,
  isInteractionAcknowledged,
} = require('./musicErrors');
const {
  isYouTubeMixList,
  parseYouTubeLink,
  extractVideoId,
  pickThumbnail,
  resolveTrackMetadata,
  normalizeMediaUrl,
  titleLooksLikeUrl,
} = require('./youtubeMeta');
const { isSafeMediaUrl } = require('./linkMeta');
const prefetch = require('./prefetch');
const autoDj = require('./autoDj');

const queues = new Map();
const streamingLinks = require('./streamingLinks');
const { encodeStream } = require('./opusEncodePool');
const playLocks = new Set();

// ~7 tasks per stream (yt-dlp + single-threaded ffmpeg); container pids.max is 512. Beyond the cap a
// new track waits for a free slot instead of failing to spawn. 0 = unlimited.
const MAX_CONCURRENT_STREAMS = Math.max(
  0,
  parseInt(process.env.MUSIC_MAX_CONCURRENT ?? '60', 10) || 0,
);
const MUSIC_STREAM_RETRIES = Math.max(
  0,
  parseInt(process.env.MUSIC_STREAM_RETRIES || '4', 10) || 4,
);
const MUSIC_EARLY_END_SEC = Math.max(
  5,
  parseInt(process.env.MUSIC_EARLY_END_SEC || '15', 10) || 15,
);
const MUSIC_SLOT_WAIT_MS = Math.max(
  5000,
  parseInt(process.env.MUSIC_SLOT_WAIT_MS || '30000', 10) || 30000,
);
let activeStreamSlots = 0;
const streamSlotWaiters = [];

function acquireStreamSlot() {
  if (MAX_CONCURRENT_STREAMS <= 0) return Promise.resolve();
  if (activeStreamSlots < MAX_CONCURRENT_STREAMS) {
    activeStreamSlots++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const entry = {
      // Handed over by releaseStreamSlot: the slot moves to this waiter, the count stays the same.
      resolve: () => {
        clearTimeout(entry.timer);
        resolve();
      },
      reject,
    };
    entry.timer = setTimeout(() => {
      const idx = streamSlotWaiters.indexOf(entry);
      if (idx >= 0) streamSlotWaiters.splice(idx, 1);
      reject(new Error('music slot wait timeout'));
    }, MUSIC_SLOT_WAIT_MS);
    streamSlotWaiters.push(entry);
  });
}

function releaseStreamSlot() {
  if (MAX_CONCURRENT_STREAMS <= 0) return;
  const next = streamSlotWaiters.shift();
  if (next) {
    next.resolve();
    return;
  }
  activeStreamSlots = Math.max(0, activeStreamSlots - 1);
}

function parseDurationToSec(d) {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  if (d.seconds) return d.seconds;
  const ts = d.timestamp || d;
  if (typeof ts !== 'string') return 0;
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class MusicManager {
  static seekDebounceTimers = new Map();

  static syncHistory(queue, queueKey) {
    queue.history = historyStore.list(queueKey);
    return queue.history;
  }

  static syncDjStats(queue, queueKey) {
    queue.djStats = new Map(Object.entries(djStatsStore.list(queueKey)));
    return queue.djStats;
  }

  /** Stream slot usage (dashboard / checks). */
  static streamSlotStats() {
    return { active: activeStreamSlots, waiting: streamSlotWaiters.length, max: MAX_CONCURRENT_STREAMS };
  }

  /** All live queues as [queueKey, queue] (dashboard). */
  static listQueues() {
    return [...queues.entries()];
  }

  static getQueue(queueKey) {
    if (!queues.has(queueKey)) {
      queues.set(queueKey, {
        _key: queueKey,
        tracks: [],
        current: null,
        player: null,
        connection: null,
        textChannel: null,
        voiceChannelId: null,
        nowPlayingMsg: null,
        loop: 'none',
        activeFilter: 'none',
        filters: [],
        subprocess: null,
        ffmpegProcess: null,
        eventsBound: false,
        skipVotes: new Set(),
        joinOrder: [],
        roomOwnerId: null,
        djStats: new Map(Object.entries(djStatsStore.list(queueKey))),
        listeners: [],
        autoDj: { enabled: false, query: 'lofi hip hop', mode: 'similar', lastArtists: [] },
        pendingSearch: null,
        progressInterval: null,
        history: historyStore.list(queueKey),
        skipIdleOnce: false,
        advanceOnIdle: false,
        _playToken: 0,
        replayTrack: null,
        lastFinishedTrack: null,
        afterReplayPause: false,
        suppressQueueFinished: false,
        pendingMoveIndex: null,
        volume: 100,
      });
    }
    return queues.get(queueKey);
  }

  static clampVolume(percent) {
    const n = Math.round(Number(percent));
    if (!Number.isFinite(n)) return 100;
    return Math.max(1, Math.min(200, n));
  }

  static volumeGain(queue) {
    return this.clampVolume(queue.volume ?? 100) / 100;
  }

  static applyResourceVolume(queue, resource) {
    if (!resource?.volume) return;
    resource.volume.setVolume(this.volumeGain(queue));
  }

  static setMusicVolume(queue, percent) {
    queue.volume = this.clampVolume(percent);
    const status = queue.player?.state?.status;
    if (
      status === AudioPlayerStatus.Playing
      || status === AudioPlayerStatus.Paused
    ) {
      this.applyResourceVolume(queue, queue.player.state.resource);
    }
    return queue.volume;
  }

  static recordRequest(queue, queueKey, userId) {
    if (!userId || userId === 'autodj') return;
    queue.djStats.set(userId, (queue.djStats.get(userId) || 0) + 1);
    if (queueKey) djStatsStore.increment(queueKey, userId, 1);
  }

  static trackId(track) {
    if (!track?.url) return (track?.title || '').toLowerCase();
    try {
      const v = new URL(track.url).searchParams.get('v');
      if (v) return `yt:${v}`;
      return track.url.split('?')[0];
    } catch {
      return track.url;
    }
  }

  static getActiveIds(queue) {
    const ids = new Set();
    if (queue.current) ids.add(this.trackId(queue.current));
    for (const t of queue.tracks) ids.add(this.trackId(t));
    return ids;
  }

  static enqueueTracks(queue, tracks, requester, queueKey = null, { limits = true } = {}) {
    const ids = this.getActiveIds(queue);
    queue.suppressQueueFinished = false;
    const added = [];
    let skipped = 0;
    let tooLong = 0;
    let overCap = 0;
    let overMine = 0;
    const firstRequesterId = requester?.id ?? tracks[0]?.requester?.id ?? null;
    let mineLeft = limits ? playLimits.queueRoomFor(queue.guild, queue, firstRequesterId) : Infinity;
    const maxSec = limits ? playLimits.maxTrackSecFor(queue.guild, firstRequesterId) : 0;

    for (const raw of tracks) {
      const track = {
        ...raw,
        requester: raw.requester ?? requester,
      };
      if (maxSec && Number(track.durationSec) > maxSec) {
        tooLong++;
        continue;
      }
      if (queue.tracks.length + added.length >= MAX_QUEUE) {
        overCap++;
        continue;
      }
      if (mineLeft <= 0) {
        overMine++;
        continue;
      }
      const id = this.trackId(track);
      if (ids.has(id)) {
        skipped++;
        continue;
      }
      ids.add(id);
      added.push(track);
      mineLeft--;
      const requesterId = requester?.id ?? raw.requester?.id;
      if (requesterId) this.recordRequest(queue, queueKey, requesterId);
    }

    queue.tracks.push(...added);
    if (overCap) console.log(`[MUSIC:${queueKey}] Queue full (${MAX_QUEUE}) — ${overCap} track(s) not added`);
    return { added, skipped, tooLong, overCap, overMine };
  }

  /** Reply when one track was not added: too long for this server, or already queued. */
  static notAddedText(result, title, guild) {
    if (result?.overCap) return t('mgr.queueFull', { max: MAX_QUEUE });
    if (result?.overMine) {
      return t('perm.memberQueueFull', { n: require('../web/guildPerms').get(guild?.id).maxQueuedPerMember });
    }
    if (result?.tooLong) {
      const { maxTrackMin } = require('../web/guildPerms').get(guild?.id);
      return t('perm.trackTooLong', { n: maxTrackMin });
    }
    return t('mgr.alreadyQueue', { title });
  }

  /** " (N duplicates skipped) (queue full: M not added)" in the user's language. */
  static enqueueSuffix(skipped, overCap = 0) {
    return (skipped ? ` ${t('mgr.dupSkipped', { n: skipped })}` : '')
      + (overCap ? ` ${t('mgr.queueFullSome', { n: overCap, max: MAX_QUEUE })}` : '');
  }

  static formatEnqueueReply(added, skipped, extra = '', overCap = 0) {
    const titleMatch = extra.match(/\*\*(.+?)\*\*/);
    const playlistTitle = titleMatch?.[1];
    const dupSuffix = this.enqueueSuffix(skipped, overCap);

    if (!added.length && overCap) return t('mgr.queueFull', { max: MAX_QUEUE });
    if (!added.length && skipped) {
      return t('mgr.allPlDup', { title: playlistTitle || 'queue' });
    }
    if (playlistTitle) {
      return t('mgr.addedPl', { count: added.length, title: playlistTitle, extra: dupSuffix });
    }
    if (added.length === 1 && added[0]?.title) {
      return t('mgr.addedQueue', { title: added[0].title });
    }
    return t('mgr.addedPl', { count: added.length, title: 'tracks', extra: dupSuffix });
  }

  static getSavedPlaylists(queueKey) {
    return playlistStore.list(queueKey);
  }

  static bindQueueContext(queue, { player, connection, message }) {
    if (player) queue.player = player;
    if (connection) queue.connection = connection;
    if (message?.channel) queue.textChannel = message.channel;
    if (message?.guild) queue.guild = message.guild;
  }

  /** Keep queue player in sync after voice reconnect (rebinds Idle/error handlers). */
  static detachPlayerEvents(queue) {
    const handlers = queue?._playerHandlers;
    const boundPlayer = queue?._eventPlayer;
    if (!handlers || !boundPlayer) return;
    try { boundPlayer.removeListener(AudioPlayerStatus.Idle, handlers.idle); } catch { /* ignore */ }
    try { boundPlayer.removeListener('error', handlers.error); } catch { /* ignore */ }
    queue._playerHandlers = null;
    queue._eventPlayer = null;
    queue.eventsBound = false;
  }

  static rebindPlayer(queueKey, player, connection) {
    if (!player) return;
    const queue = this.getQueue(queueKey);
    const previous = queue.player;
    if (previous && previous !== player) {
      this.detachPlayerEvents(queue);
      try { previous.stop(true); } catch { /* ignore */ }
    }
    queue.player = player;
    if (connection) queue.connection = connection;
    this.ensurePlayerEvents(queueKey);
    if (previous && previous !== player && queue.textChannel) {
      queue.textChannel.send(t('mgr.reconnected')).catch(() => {});
    }
    if (
      queue.current
      && player.state?.status === AudioPlayerStatus.Idle
      && !queue._playbackStarting
      && !this.isTrackLoading(queue)
    ) {
      const pos = this.getPlaybackPosition(queue);
      const track = {
        ...queue.current,
        startSec: pos,
        startedAt: undefined,
        pausedAt: undefined,
        _streamRetries: queue.current._streamRetries || 0,
      };
      void this.playTrack(queueKey, track, { replay: true }).catch((err) => {
        logMusicError(err, 'resume', { queueKey, title: track.title });
      });
    }
  }

  static isNaturalTrackEnd(queue) {
    const track = queue.current;
    if (!track) return true;
    const elapsed = this.getPlaybackPosition(queue);
    const duration = track.durationSec || 0;
    if (duration > MUSIC_EARLY_END_SEC) {
      return elapsed >= Math.max(duration - 4, duration * 0.92);
    }
    if (duration > 0) {
      return elapsed >= duration - 2;
    }
    return elapsed >= MUSIC_EARLY_END_SEC;
  }

  static isEarlyStreamFailure(queue) {
    return Boolean(queue.current) && !this.isNaturalTrackEnd(queue);
  }

  static getStreamRetries(track) {
    return track?._streamRetries || 0;
  }

  static retryCurrentTrack(queueKey, queue) {
    const track = queue.current;
    if (!track) return false;
    const retries = this.getStreamRetries(track);
    if (retries >= MUSIC_STREAM_RETRIES) return false;

    const pos = Math.max(0, this.getPlaybackPosition(queue) - 1);
    const retry = {
      ...track,
      startSec: pos,
      startedAt: undefined,
      pausedAt: undefined,
      _streamRetries: retries + 1,
    };
    retry._ytdlpPlayerClient = nextFallbackClient(retry._streamRetries);
    queue._lastStreamError403 = false;

    logMusicError(
      new Error(`stream retry ${retry._streamRetries}/${MUSIC_STREAM_RETRIES}`),
      'stream-retry',
      { queueKey, title: track.title },
    );
    queue.textChannel?.send(
      t('mgr.streamRetry', { n: retry._streamRetries, max: MUSIC_STREAM_RETRIES }),
    ).catch(() => {});

    queue.skipIdleOnce = true;
    queue.replayTrack = retry;
    if (queue.player?.state?.status !== AudioPlayerStatus.Idle) {
      queue.player.stop();
      return true;
    }
    queue.skipIdleOnce = false;
    queue.replayTrack = null;
    void this.playTrack(queueKey, retry, { replay: true }).catch((err) => {
      logMusicError(err, 'retry', { queueKey, title: track.title });
    });
    return true;
  }

  static deferWhenPlaybackSettled(queueKey, queue, fn) {
    void this.waitForProcessesDown(queue).then(() => {
      if (queue._playbackStarting || this.hasActivePlayback(queue, queue.player)) {
        setTimeout(() => {
          if (!queue._playbackStarting && !this.hasActivePlayback(queue, queue.player)) fn();
        }, 150);
        return;
      }
      fn();
    });
  }

  static syncVoiceFromClient(queueKey, getVoice) {
    if (!getVoice) return;
    const { player, connection } = getVoice();
    if (player) this.rebindPlayer(queueKey, player, connection);
  }

  static schedulePlayNext(queueKey, { naturalEnd = true } = {}) {
    const queue = this.getQueue(queueKey);
    queue._advanceNaturalEnd = naturalEnd;
    if (!queue._playChain) queue._playChain = Promise.resolve();
    queue._playChain = queue._playChain
      .then(() => this.playNext(queueKey))
      .catch((err) => {
        logMusicError(err, 'playnext', { queueKey });
        return queue.textChannel?.send(t('err.playback')).catch(() => {});
      });
    return queue._playChain;
  }

  static hasActivePlayback(queue, player) {
    if (!queue?.current || !player) return false;
    const status = player.state?.status;
    return status === AudioPlayerStatus.Playing
      || status === AudioPlayerStatus.Paused
      || status === AudioPlayerStatus.Buffering
      || status === AudioPlayerStatus.AutoPaused;
  }

  /** No audio now: no player, idle with empty queue, and not loading. */
  static isNothingPlaying(queue) {
    if (!queue?.player) return true;
    if (this.isTrackLoading(queue)) return false;
    if (this.hasActivePlayback(queue, queue.player)) return false;
    if (queue.tracks?.length > 0) return false;
    return true;
  }

  static isTrackLoading(queue) {
    return Boolean(queue?._streamSlotHeld);
  }

  static canStartPlayback(queue, player) {
    if (!player) return false;
    if (this.isTrackLoading(queue)) return false;
    if (this.hasActivePlayback(queue, player)) return false;
    return true;
  }

  static ensureVoicePlayback(queue) {
    if (queue.connection?.subscribe && queue.player) {
      queue.connection.subscribe(queue.player);
    }
  }

  /** Master: tear down bridge relay before music (slaves no-op). */
  static armMusicPlayback(queue) {
    queue.onMusicStart?.();
    this.ensureVoicePlayback(queue);
  }

  static async resendMusicUI(message, queueKey) {
    const queue = this.getQueue(queueKey);
    if (!queue.current) {
      return message.reply(t('mgr.nothingPlay'));
    }
    if (message.guild) await this.refreshListeners(queue, message.guild);

    const saved = this.getSavedPlaylists(queueKey);
    const embed = buildNowPlayingEmbed(queue, queueKey);
    const components = buildControls(queue, queueKey, saved);
    queue.nowPlayingMsg = await message.reply({ embeds: [embed], components });
    return queue.nowPlayingMsg;
  }

  static resumeIfPaused(queue) {
    const player = queue?.player;
    if (!player || player.state.status !== AudioPlayerStatus.Paused) return false;
    player.unpause();
    return true;
  }

  static recordPlayedTrack(queue, queueKey, track) {
    if (!track?.url) return;
    if (!track.startedAt) return;
    queue.history = historyStore.push(queueKey, track);
    try {
      require('../web/playStats').record(queueKey, track, this.getPlaybackPosition(queue));
    } catch { /* stats are best-effort */ }
  }

  /**
   * Spotify / Apple Music / Deezer / Anghami / TIDAL link -> YouTube matches.
   * The first match starts playing right away; the rest are matched in the background, in order.
   * `loading` (Discord message) is optional: the dashboard passes null and gets errors thrown instead.
   * Resolves once the first track is queued (handlePlay holds a per-queue lock until then).
   */
  static async loadStreamingLink(queue, url, requester, loading, player, queueKey) {
    const label = streamingLinks.LABELS[streamingLinks.streamingPlatform(url)] || 'Link';
    const edit = (content) => (loading ? loading.edit(content).catch(() => {}) : Promise.resolve());
    await edit(t('mgr.streamingResolving', { label }));
    // Only stopPlayback cancels: a second streaming link must not stop the first one's matching.
    const cancelToken = queue._streamingCancel || 0;
    const isCancelled = () => (queue._streamingCancel || 0) !== cancelToken;
    let single = true;
    let firstTrack = null;
    let firstError = null;
    let firstReady;
    const first = new Promise((r) => { firstReady = r; });
    const job = (async () => {
      try {
        const res = await streamingLinks.enqueueStreamingLink({
          url,
          search: (q) => yts(q),
          makeTrack: (v, item) => ({
            ...this.videoToTrack(v, requester),
            title: streamingLinks.displayTitle(item) || v.title,
            sourceUrl: url,
          }),
          enqueue: (tracks) => {
            if (isCancelled()) return 0;
            const n = this.enqueueTracks(queue, tracks, requester, queueKey).added.length;
            // The first track may already have ended/failed: keep the queue moving.
            if (n && firstTrack && !queue.current && !this.hasActivePlayback(queue, player)) {
              void this.afterEnqueue(queueKey, player).catch(() => {});
            }
            return n;
          },
          isCancelled,
          onFirst: async (r, track) => {
            single = r.items.length <= 1;
            firstTrack = track;
            const idle = player?.state?.status === AudioPlayerStatus.Idle;
            if (single) {
              if (idle && loading) await this.prepareNowPlayingSlot(queue, loading);
              else await edit(t('mgr.streamingTrack', { label, title: track.title }));
            } else {
              await edit(t('mgr.streamingFirst', { label, name: r.name || label, n: r.items.length - 1 }));
            }
            firstReady();
            await this.afterEnqueue(queueKey, player);
          },
        });
        if (!single && !isCancelled() && loading) {
          const miss = res.missed ? t('mgr.streamingMissed', { n: res.missed }) : '';
          const content = t('mgr.streamingDone', { label, name: res.name || label, ok: res.ok, total: res.total, miss });
          // The loading message may have become the now-playing slot; post a fresh line instead.
          if (queue.nowPlayingMsg === loading) await queue.textChannel?.send(content).catch(() => {});
          else await edit(content);
        }
      } catch (err) {
        logMusicError(err, 'streaming', { queueKey, url });
        if (!firstTrack) firstError = err;
        const content = err.code === 'NO_MATCH'
          ? t('mgr.streamingNoMatch', { title: String(err.message).replace(/^no YouTube match for /, '').replace(/"/g, '') })
          : t('mgr.streamingFail', { label, err: String(err.message || err).slice(0, 180) });
        // Never overwrite the message once it has become the now-playing panel.
        if (loading && queue.nowPlayingMsg !== loading) {
          await loading.edit({ content, embeds: [], components: [] }).catch(() => {});
        } else if (loading) {
          await queue.textChannel?.send(content).catch(() => {});
        }
      } finally {
        firstReady();
      }
    })();
    job.catch(() => {});
    await first;
    if (!loading && firstError) throw firstError;
    return firstTrack;
  }

  static autoDjCandidates(videos) {
    const list = Array.isArray(videos) ? videos : [];
    const skipTitle = /\b(mix|mega|non.?stop|full album|1 hour|10 hours|lyrics)\b/i;
    const usable = list.filter((v) => !skipTitle.test(v.title || ''));
    const reasonable = usable.filter((v) => {
      const sec = parseDurationToSec(v.duration);
      return sec >= 45 && sec <= 600;
    });
    const pool = (reasonable.length ? reasonable : usable.slice(0, 12)).slice(0, 12);
    shuffleArray(pool);
    return pool;
  }

  /**
   * Auto-DJ v2: top up the shelf — call whenever the shelf is empty (ticker does this every 20s).
   * similar mode: seed = last played YouTube video, fetch its "related" mix and pick from it.
   * No seed / mix failed or empty / nothing left after dedupe -> mood mode fallback
   * (query rotates through moodQueries() on every fill so the variety is larger).
   * All network calls are wrapped — on failure: log once + return false, bot never crashes.
   */
  static async fillAutoDjQueue(queue, queueKey, { silent = false } = {}) {
    const dj = queue?.autoDj;
    if (!dj?.enabled) return false;
    try {
      const wasEmpty = !queue.current && queue.tracks.length === 0;
      const recent = autoDj.recentKeys(queue);
      let pick = null;

      if (dj.mode === 'similar') {
        const seed = autoDj.similarSeed(queue);
        if (seed) {
          try {
            const mix = await yts({ listId: `RD${seed}`, videoId: seed });
            pick = autoDj.pickNext(mix?.videos || [], {
              recent,
              lastArtists: dj.lastArtists,
            });
          } catch (err) {
            logMusicError(err, 'autodj', { queueKey, phase: 'similar-mix', seed });
            pick = null;
          }
        }
      }

      if (!pick) {
        const query = autoDj.nextMoodQuery(dj, dj.query);
        const res = await yts(query);
        const pool = this.autoDjCandidates(res.videos);
        pick = autoDj.pickNext(pool, { recent, lastArtists: dj.lastArtists });
      }

      if (!pick) return false;
      const djTrack = this.videoToTrack(pick, { toString: () => '🤖 Auto-DJ', id: 'autodj' });
      const { added } = this.enqueueTracks(queue, [djTrack], null, queueKey);
      if (!added.length) return false;
      autoDj.recordArtist(dj, pick);
      if (!silent && wasEmpty) {
        queue.textChannel?.send(t('mgr.autoDjAdded', { title: pick.title })).catch(() => {});
      }
      return true;
    } catch (err) {
      logMusicError(err, 'autodj', { queueKey, query: dj.query, mode: dj.mode || 'mood' });
      return false;
    }
  }

  /** Auto-DJ top-up: track playing + shelf empty + Auto-DJ enabled + no fill in flight -> refill. */
  static topUpAutoDj(queue, queueKey) {
    const dj = queue?.autoDj;
    if (!dj?.enabled || !queue.current || queue.tracks.length > 0 || dj._busy) return false;
    dj._busy = true;
    void this.fillAutoDjQueue(queue, queueKey, { silent: true })
      .catch(() => {})
      .finally(() => { dj._busy = false; });
    return true;
  }

  static maybeStartAutoDj(queueKey) {
    const queue = this.getQueue(queueKey);
    if (!queue.autoDj?.enabled || !queue.player) return false;
    if (!this.canStartPlayback(queue, queue.player)) return false;
    this.ensurePlayerEvents(queueKey);
    this.armMusicPlayback(queue);
    void this.schedulePlayNext(queueKey);
    return true;
  }

  static skipCurrent(queue, queueKey) {
    const player = queue?.player;
    if (!player) return;
    this.cancelPendingSeek(queueKey, queue);
    if (queue.current) this.recordPlayedTrack(queue, queueKey, queue.current);
    queue.filterPlaybackFailed = false;
    queue.replayTrack = null;
    queue.skipVotes.clear();
    // Abort any in-flight playTrack so playNext can run after skip.
    queue._playToken = (queue._playToken || 0) + 1;
    queue._playbackStarting = false;
    this.killProcesses(queue);

    const status = player.state.status;
    if (status === AudioPlayerStatus.Paused) player.unpause();

    if (status === AudioPlayerStatus.Idle) {
      void this.schedulePlayNext(queueKey);
      return;
    }

    queue.advanceOnIdle = true;
    queue.skipIdleOnce = true;
    player.stop();
  }

  static async startPlaybackIfIdle(queueKey, player) {
    if (!player) return false;
    const queue = this.getQueue(queueKey);
    this.ensurePlayerEvents(queueKey);
    if (player.state.status !== AudioPlayerStatus.Idle) return false;
    if (!queue.tracks.length && !queue.current) return false;
    await this.schedulePlayNext(queueKey);
    return true;
  }

  static async afterEnqueue(queueKey, player) {
    this.ensurePlayerEvents(queueKey);
    const queue = this.getQueue(queueKey);
    if (this.resumeIfPaused(queue)) {
      await this.updateNowPlaying(queueKey, queue.guild);
      return;
    }
    if (await this.startPlaybackIfIdle(queueKey, player)) return;
    if (queue.tracks.length && !this.hasActivePlayback(queue, player)) {
      await this.schedulePlayNext(queueKey);
    }
  }

  static async afterEnqueueThenNowPlaying(queueKey, guild, { forceNew = false, skipNowPlaying = false } = {}) {
    await this.afterEnqueue(queueKey, this.getQueue(queueKey).player);
    const queue = this.getQueue(queueKey);
    if (queue._playChain) await queue._playChain.catch(() => {});
    if (queue.current && !skipNowPlaying) await this.sendNowPlaying(queueKey, guild, { forceNew });
  }

  static videoToTrack(v, requester) {
    const videoId = v.videoId || extractVideoId(v.url);
    return {
      title: v.title,
      url: v.url || `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: pickThumbnail(v, videoId),
      durationSec: parseDurationToSec(v.duration),
      requester,
    };
  }

  static humanMemberIds(channel) {
    if (!channel?.isVoiceBased?.()) return [];
    return [...channel.members.values()]
      .filter(m => !m.user.bot)
      .map(m => m.id);
  }

  static syncRoomRoster(queue, guild) {
    if (!queue.voiceChannelId || !guild) return;
    const ch = guild.channels.cache.get(queue.voiceChannelId);
    if (!ch?.isVoiceBased?.()) return;

    const humanIds = this.humanMemberIds(ch);
    queue.listeners = humanIds;

    if (!queue.joinOrder) queue.joinOrder = [];
    queue.joinOrder = queue.joinOrder.filter(id => humanIds.includes(id));
    for (const id of humanIds) {
      if (!queue.joinOrder.includes(id)) queue.joinOrder.push(id);
    }
    if (!queue.roomOwnerId || !humanIds.includes(queue.roomOwnerId)) {
      queue.roomOwnerId = queue.joinOrder[0] ?? null;
    }
  }

  static async refreshListeners(queue, guild) {
    this.syncRoomRoster(queue, guild);
  }

  // T70 (review U9): busy rooms filled the chat with "new owner" lines. Announce only while music
  // is on (that is when owning matters), at most once per OWNER_ANNOUNCE_GAP_MS per room.
  static async announceNewOwner(queue, newOwnerId, { previousOwnerId = null } = {}) {
    if (!newOwnerId || !queue.textChannel) return;
    if (!queue.current && !queue.tracks?.length) return;
    const now = Date.now();
    if (queue._ownerAnnouncedAt && now - queue._ownerAnnouncedAt < OWNER_ANNOUNCE_GAP_MS) return;
    queue._ownerAnnouncedAt = now;
    await queue.textChannel.send(t('mgr.transferOk', { id: newOwnerId })).catch(() => {});
  }

  static onVoiceStateUpdate(queueKey, voiceChannelId, oldState, newState) {
    const queue = this.getQueue(queueKey);
    if (voiceChannelId) queue.voiceChannelId = voiceChannelId;

    const member = newState.member ?? oldState.member;
    const userId = member?.id ?? newState.id;
    if (!userId || member?.user?.bot) return;

    const joined = newState.channelId === voiceChannelId
      && oldState.channelId !== voiceChannelId;
    const left = oldState.channelId === voiceChannelId
      && newState.channelId !== voiceChannelId;
    if (!joined && !left) return;

    if (!queue.joinOrder) queue.joinOrder = [];

    if (joined) {
      require('./emptyRoom').onJoin(queueKey, queue);
      if (!queue.joinOrder.includes(userId)) {
        queue.joinOrder.push(userId);
        if (!queue.roomOwnerId) {
          queue.roomOwnerId = userId;
          void this.announceNewOwner(queue, userId);
        }
      }
      return;
    }

    queue.joinOrder = queue.joinOrder.filter(id => id !== userId);
    queue.skipVotes?.delete(userId);
    if (queue.roomOwnerId === userId) {
      const previousOwnerId = userId;
      const newOwnerId = queue.joinOrder[0] ?? null;
      queue.roomOwnerId = newOwnerId;
      if (newOwnerId) {
        void this.announceNewOwner(queue, newOwnerId, { previousOwnerId });
      }
    }
  }

  static async handlePlay(message, query, player, connection, queueKey, voiceChannelId, { loading = null } = {}) {
    const lockKey = `play:${queueKey}`;
    if (playLocks.has(lockKey)) {
      await message.reply(t('mgr.processing')).catch(() => {});
      return;
    }
    playLocks.add(lockKey);

    const queue = this.getQueue(queueKey);
    queue.player = player;
    queue.connection = connection;
    queue.textChannel = message.channel;
    queue.voiceChannelId = voiceChannelId;
    queue.guild = message.guild;

    if (!query) {
      playLocks.delete(lockKey);
      return message.reply(t('music.pl.addFirst', { cmd: cmd() }));
    }

    const limited = playLimits.checkPlayRequest(message.guild, message.author?.id, query);
    if (limited) {
      playLocks.delete(lockKey);
      if (loading) return loading.edit(t(limited.key, limited.vars));
      return message.reply(t(limited.key, limited.vars));
    }

    if (!loading) {
      try {
        loading = await message.reply(t('mgr.searching'));
      } catch (err) {
        playLocks.delete(lockKey);
        throw err;
      }
    }

    try {
      if (query.startsWith('http') && streamingLinks.streamingPlatform(query)) {
        await this.loadStreamingLink(queue, query, message.author, loading, player, queueKey);
        return;
      }
      if (query.startsWith('http')) {
        query = normalizeMediaUrl(query);
        if (!isSafeMediaUrl(query)) return loading.edit(t('err.noResults'));
        const link = parseYouTubeLink(query);
        if (link.listId && link.videoId && !link.isPlaylistPage) {
          await this.promptUrlChoice(loading, queue, queueKey, link, message.author);
          return;
        }
        if (link.listId) {
          if (!link.videoId && isYouTubeMixList(link.listId)) {
            await loading.edit(formatMixPlaylistError(false));
            return;
          }
          await this.loadYouTubePlaylist(
            queue, link.listId, message.author, loading, player, queueKey,
            { videoId: link.videoId || null },
          );
          return;
        }
        const videoUrl = link.videoId
          ? `https://www.youtube.com/watch?v=${link.videoId}`
          : query;
        const { added, title } = await this.addSingleUrl(queue, videoUrl, message.author, loading, queueKey);
        if (added && player.state.status === AudioPlayerStatus.Idle) {
          await this.prepareNowPlayingSlot(queue, loading);
        } else if (added) {
          await loading.edit(addedQueueText(queue, title));
        }
      } else {
        const results = await yts(query);
        if (!results.videos.length) return loading.edit(t('err.noResults'));

        if (results.videos.length === 1) {
          const track = this.videoToTrack(results.videos[0], message.author);
          const res = this.enqueueTracks(queue, [track], message.author, queueKey);
          const { added } = res;
          if (!added.length) {
            return loading.edit(this.notAddedText(res, track.title, queue.guild));
          }
          if (player.state.status === AudioPlayerStatus.Idle) {
            await this.prepareNowPlayingSlot(queue, loading);
          } else {
            await loading.edit(addedQueueText(queue, track.title));
          }
        } else {
          queue.pendingSearch = {
            videos: results.videos.slice(0, SEARCH_RESULT_LIMIT),
            requester: message.author,
          };
          // Warm the top picks while the user reads the list (best effort).
          let warmed = 0;
          for (const v of results.videos) {
            if (!v?.url) continue;
            if (warmed >= 3) break;
            try { prefetch.prefetch(normalizeMediaUrl(v.url)); } catch { /* best effort */ }
            warmed++;
          }
          const embed = buildSearchEmbed(query, queueKey);
          const row = buildSearchSelect(results.videos, queueKey);
          await loading.edit({ content: null, embeds: [embed], components: [row] });
          return;
        }
      }

      await this.afterEnqueue(queueKey, player);
    } catch (err) {
      const ctx = query.includes('list=') || query.includes('playlist')
        ? 'playlist'
        : 'search';
      logMusicError(err, ctx, { queueKey });
      await loading.edit(formatMusicError(err, ctx)).catch(() => {});
    } finally {
      playLocks.delete(lockKey);
    }
  }

  static async loadYouTubePlaylist(
    queue, listId, requester, loading, player, queueKey,
    { videoId = null } = {},
  ) {
    try {
      await loading.edit(t('mgr.loadingPlaylist')).catch(() => {});
      const list = await yts.fetchYouTubePlaylistFast(listId, videoId || null, (full) => {
        const q = this.getQueue(queueKey);
        const known = this.getActiveIds(q);
        const rest = full.videos
          .map(v => this.videoToTrack(v, requester))
          .filter(trk => !known.has(this.trackId(trk)));
        if (rest.length) this.enqueueTracks(q, rest, requester, queueKey);
      });
      if (!list?.videos?.length) {
        throw new Error('playlist error: unviewable');
      }
      const tracks = list.videos.map(v => this.videoToTrack(v, requester));
      const { added, skipped, overCap } = this.enqueueTracks(queue, tracks, requester, queueKey);
      if (added.length && player.state.status === AudioPlayerStatus.Idle) {
        await this.prepareNowPlayingSlot(queue, loading);
      } else {
        await loading.edit(
          this.formatEnqueueReply(added, skipped, `from **${list.title}**`, overCap) ||
          t('mgr.addedPl', { count: 0, title: list.title, extra: '' }),
        );
      }
      await this.afterEnqueue(queueKey, player);
    } catch (err) {
      logMusicError(err, 'playlist', { queueKey, url: listId });
      const mix = isYouTubeMixList(listId);
      const hasVideo = Boolean(videoId);
      const content = mix ? formatMixPlaylistError(hasVideo) : formatMusicError(err, 'playlist');
      const components = mix && hasVideo ? [buildVideoOnlyRow(queueKey)] : [];
      if (mix && hasVideo) {
        queue.pendingUrlChoice = {
          videoId,
          listId,
          requesterId: requester.id,
          requester,
        };
      }
      await loading.edit({ content, embeds: [], components });
    }
  }

  static async promptUrlChoice(loading, queue, queueKey, link, requester) {
    queue.pendingUrlChoice = {
      videoId: link.videoId,
      listId: link.listId,
      requesterId: requester.id,
      requester,
    };

    const videoUrl = `https://www.youtube.com/watch?v=${link.videoId}`;
    let videoTitle = link.videoId;
    let playlistTitle = 'Playlist / mix';

    try {
      const info = await resolveTrackMetadata({
        title: '', url: videoUrl, thumbnail: '', durationSec: 0,
      });
      if (info.title) videoTitle = info.title;
    } catch { /* keep fallback */ }

    try {
      const meta = await yts.fetchPlaylistMeta(link.listId, link.videoId);
      if (meta?.title) playlistTitle = meta.title;
    } catch { /* keep fallback */ }

    queue.pendingUrlChoice.prefetch = yts.fetchYouTubePlaylist(link.listId, link.videoId).catch(() => null);

    await loading.edit({
      content: null,
      embeds: [buildUrlChoiceEmbed(videoTitle, playlistTitle, queueKey)],
      components: [buildUrlChoiceRow(queueKey)],
    });
  }

  static async addSingleUrl(queue, url, requester, replyMsg, queueKey = null) {
    const track = await resolveTrackMetadata({ title: url, url, thumbnail: '', durationSec: 0 });
    const res = this.enqueueTracks(queue, [track], requester, queueKey);
    const { added, skipped } = res;
    if (replyMsg?.edit && !added.length) {
      await replyMsg.edit(this.notAddedText(res, track.title, queue.guild));
    }
    return { added: added.length, skipped, title: track.title };
  }

  static ensurePlayerEvents(queueKey) {
    const queue = this.getQueue(queueKey);
    if (queue.eventsBound || !queue.player) return;

    const idleHandler = () => {
      if (queue._eventPlayer && queue.player !== queue._eventPlayer) return;

      if (queue.skipIdleOnce) {
        queue.skipIdleOnce = false;
        const track = queue.replayTrack;
        queue.replayTrack = null;
        if (track) {
          return this.playTrack(queueKey, track, { replay: true }).catch(console.error);
        }
        // Only user skip (or explicit advance) should chain playNext here —
        // playNext/playTrack already advance when they intentionally stop().
        if (queue.advanceOnIdle) {
          queue.advanceOnIdle = false;
          this.deferWhenPlaybackSettled(queueKey, queue, () => {
            this.schedulePlayNext(queueKey);
          });
        }
        return;
      }

      if (queue.filterPlaybackFailed && queue.current) {
        queue.filterPlaybackFailed = false;
        const failedLabel = filterLabel(queue.activeFilter) ?? 'unknown';
        const retry = {
          ...queue.current,
          startedAt: undefined,
          pausedAt: undefined,
        };
        this.setFilter(queue, 'none');
        queue.textChannel?.send(
          t('mgr.filterNext', { label: failedLabel }),
        ).catch(() => {});
        queue.skipIdleOnce = true;
        queue.replayTrack = retry;
        if (queue.player.state.status !== AudioPlayerStatus.Idle) {
          queue.player.stop();
          return;
        }
        queue.skipIdleOnce = false;
        queue.replayTrack = null;
        return this.playTrack(queueKey, retry, { replay: true }).catch(console.error);
      }

      let naturalEnd = true;
      if (this.isEarlyStreamFailure(queue)) {
        if (this.retryCurrentTrack(queueKey, queue)) return;
        naturalEnd = false;
        queue.textChannel?.send(t('err.playback')).catch(() => {});
      }

      if (queue.loop === 'track' && queue.current) {
        queue.tracks.unshift({
          ...queue.current,
          startedAt: undefined,
          startSec: 0,
          pausedAt: undefined,
          _streamRetries: 0,
        });
      } else if (queue.loop === 'queue' && queue.current) {
        queue.tracks.push(queue.current);
      }
      if (queue.current && naturalEnd) {
        this.recordPlayedTrack(queue, queueKey, queue.current);
      }
      const advanceNatural = naturalEnd;
      this.deferWhenPlaybackSettled(queueKey, queue, () => {
        this.schedulePlayNext(queueKey, { naturalEnd: advanceNatural });
      });
    };

    const errorHandler = (err) => {
      logMusicError(err, 'player', { queueKey });
      if (queue._playbackStarting || this.hasActivePlayback(queue, queue.player)) return;
      let naturalEnd = true;
      if (queue.current && this.isEarlyStreamFailure(queue)) {
        if (this.retryCurrentTrack(queueKey, queue)) return;
        naturalEnd = false;
        queue.textChannel?.send(t('err.playback')).catch(() => {});
      }
      this.deferWhenPlaybackSettled(queueKey, queue, () => {
        this.schedulePlayNext(queueKey, { naturalEnd });
      });
    };

    queue.player.on(AudioPlayerStatus.Idle, idleHandler);
    queue.player.on('error', errorHandler);
    queue._playerHandlers = { idle: idleHandler, error: errorHandler };
    queue._eventPlayer = queue.player;
    queue.eventsBound = true;
  }

  static getPlaybackPosition(queue) {
    const track = queue.current;
    if (!track) return 0;
    const base = track.startSec || 0;
    if (!track.startedAt) return base;
    if (queue.player?.state?.status === AudioPlayerStatus.Paused && track.pausedAt) {
      return base + (track.pausedAt - track.startedAt) / 1000;
    }
    return base + (Date.now() - track.startedAt) / 1000;
  }

  static async waitForProcessesDown(queue) {
    if (queue._killWait) await queue._killWait;
    else await new Promise(r => setTimeout(r, 120));
  }

  static async seekCurrent(queueKey, deltaSec) {
    const queue = this.getQueue(queueKey);
    if (!queue.current || !queue.player) return null;
    const target = queue.current;
    if (!this.seekDebounceTimers.has(queueKey)) {
      // First resolver of a fresh debounce window: bind delta to the current track.
      queue._seekTarget = target;
      queue._seekPendingDelta = deltaSec;
    } else if (queue._seekTarget !== target) {
      // Track changed (skip) inside an open window: drop old resolvers, start over.
      this.cancelPendingSeek(queueKey, queue);
      queue._seekTarget = target;
      queue._seekPendingDelta = deltaSec;
    } else {
      queue._seekPendingDelta = (queue._seekPendingDelta || 0) + deltaSec;
    }
    if (!queue._seekResolvers) queue._seekResolvers = [];

    return new Promise((resolve) => {
      queue._seekResolvers.push(resolve);
      clearTimeout(this.seekDebounceTimers.get(queueKey));
      const timer = setTimeout(async () => {
        this.seekDebounceTimers.delete(queueKey);
        const seekTarget = queue._seekTarget;
        queue._seekTarget = null;
        const resolvers = queue._seekResolvers.splice(0);
        const totalDelta = queue._seekPendingDelta || 0;
        queue._seekPendingDelta = 0;
        if (queue.current !== seekTarget) {
          resolvers.forEach(r => r(null));
          return;
        }
        const pos = await this.executeSeek(queueKey, totalDelta);
        resolvers.forEach(r => r(pos));
      }, 300);
      this.seekDebounceTimers.set(queueKey, timer);
    });
  }

  static cancelPendingSeek(queueKey, queue) {
    clearTimeout(this.seekDebounceTimers.get(queueKey));
    this.seekDebounceTimers.delete(queueKey);
    if (queue._seekResolvers?.length) {
      queue._seekResolvers.splice(0).forEach(r => r(null));
    }
    queue._seekPendingDelta = 0;
    queue._seekTarget = null;
  }

  static async executeSeek(queueKey, deltaSec) {
    const queue = this.getQueue(queueKey);
    if (!queue.current || !queue.player) return null;

    const wasPaused = queue.player.state.status === AudioPlayerStatus.Paused;
    const duration = queue.current.durationSec || 0;
    let pos = this.getPlaybackPosition(queue) + deltaSec;
    pos = Math.max(0, pos);
    if (duration > 0) pos = Math.min(Math.max(0, duration - 0.5), pos);

    const track = {
      ...queue.current,
      startSec: pos,
      startedAt: undefined,
      pausedAt: undefined,
    };

    queue.filterPlaybackFailed = false;
    queue.afterReplayPause = wasPaused;
    queue.skipIdleOnce = true;
    queue.replayTrack = track;
    this.killProcesses(queue);
    await this.waitForProcessesDown(queue);

    if (queue.player.state.status !== AudioPlayerStatus.Idle) {
      queue.player.stop();
      return pos;
    }

    queue.skipIdleOnce = false;
    queue.replayTrack = null;
    try {
      await this.playTrack(queueKey, track, { replay: true });
      return pos;
    } catch {
      return null;
    }
  }

  static killProcesses(queue) {
    if (queue._streamSlotHeld) {
      queue._streamSlotHeld = false;
      releaseStreamSlot();
    }
    queue.suppressFfmpegFailure = true;
    const killWaits = [];

    if (queue.subprocess) {
      try {
        queue.subprocess.stdout?.unpipe?.();
        queue.subprocess.kill?.('SIGTERM');
      } catch { /* ignore */ }
      queue.subprocess = null;
    }
    if (queue.ffmpegProcess) {
      const proc = queue.ffmpegProcess;
      proc.intentionalKill = true;
      killWaits.push(new Promise((resolve) => {
        const finish = () => resolve();
        proc.once('close', finish);
        setTimeout(finish, 450);
      }));
      try {
        proc.stdin?.end?.();
        proc.kill('SIGTERM');
      } catch { /* ignore */ }
      queue.ffmpegProcess = null;
    }
    if (queue.progressInterval) {
      clearInterval(queue.progressInterval);
      queue.progressInterval = null;
    }

    if (killWaits.length) {
      queue._killWait = Promise.all(killWaits).finally(() => {
        queue._killWait = null;
        queue.suppressFfmpegFailure = false;
      });
    } else {
      queue.suppressFfmpegFailure = false;
    }
  }

  static async playNext(queueKey) {
    const queue = this.getQueue(queueKey);
    const naturalEnd = queue._advanceNaturalEnd !== false;
    queue._advanceNaturalEnd = true;

    // Stale Idle from a replaced AudioPlayer, or a race while yt-dl/ffmpeg is
    // still wiring up — must not kill the fresh stream or post "queue finished".
    if (queue._playbackStarting) return;
    if (this.hasActivePlayback(queue, queue.player)) return;

    queue.filterPlaybackFailed = false;
    queue.replayTrack = null;
    if (queue.player?.state?.status !== AudioPlayerStatus.Idle) {
      queue.skipIdleOnce = true;
      queue.player.stop();
    }
    this.killProcesses(queue);
    queue.skipVotes.clear();

    if (queue.tracks.length === 0) {
      const lastTrack = queue.current ? { ...queue.current } : null;
      queue.current = null;

      if (queue.autoDj?.enabled) {
        await this.fillAutoDjQueue(queue, queueKey);
      }

      if (queue.tracks.length > 0) {
        if (lastTrack) await this.finalizeNowPlayingMessage(queue, queueKey, lastTrack);
        this.ensureVoicePlayback(queue);
        const track = queue.tracks.shift();
        await this.playTrack(queueKey, track);
        return;
      }

      if (lastTrack) {
        queue.lastFinishedTrack = lastTrack;
        await this.showFinishedNowPlayingUI(queue, queueKey, lastTrack);
      } else {
        queue.lastFinishedTrack = null;
        await this.clearNowPlayingUI(queue);
      }

      if (!queue.suppressQueueFinished && naturalEnd) {
        await queue.textChannel?.send(t('mgr.queueDone')).catch(() => {});
      }
      queue.suppressQueueFinished = false;
      if (queue.onQueueEmpty) queue.onQueueEmpty();
      return;
    }

    const finished = queue.current ? { ...queue.current } : null;
    if (finished) await this.finalizeNowPlayingMessage(queue, queueKey, finished);
    const track = queue.tracks.shift();
    await this.playTrack(queueKey, track);
  }

  static spawnFfmpeg(args) {
    return spawn(ffmpegPath, ['-threads', '1', ...args], { windowsHide: true });
  }

  static async spawnFfmpegSafe(queue, args) {
    await this.waitForProcessesDown(queue);
    try {
      return this.spawnFfmpeg(args);
    } catch (err) {
      if (err?.code !== 'UNKNOWN' && err?.errno !== -4094) throw err;
      await new Promise(r => setTimeout(r, 400));
      return this.spawnFfmpeg(args);
    }
  }

  static async playTrack(queueKey, track, { replay = false } = {}) {
    const queue = this.getQueue(queueKey);
    const playToken = queue._playToken || 0;
    const aborted = () => (queue._playToken || 0) !== playToken;

    const abortPlayback = () => {
      this.killProcesses(queue);
    };

    queue._playbackStarting = true;
    try {
    if (!replay) {
      queue.replayTrack = null;
      if (queue.player?.state?.status !== AudioPlayerStatus.Idle) {
        queue.skipIdleOnce = true;
        queue.player.stop();
      }
      this.killProcesses(queue);
    } else {
      await this.waitForProcessesDown(queue);
    }
    queue.suppressFfmpegFailure = false;

    if (aborted()) {
      abortPlayback();
      return;
    }

    queue.onMusicStart?.();
    this.ensureVoicePlayback(queue);
    // Bridge capture resync after playback is armed — avoids racing voice setup.
    queue.onBridgeResync?.();

    try {
      // One slot per queue: a replay (retry / stall restart / seek / filter) keeps the slot it holds.
      if (!queue._streamSlotHeld) {
        await acquireStreamSlot();
        // A concurrent playTrack on this queue may have taken one meanwhile — never hold two.
        if (queue._streamSlotHeld) releaseStreamSlot();
      }
    } catch (err) {
      abortPlayback();
      logMusicError(err, 'slot', { queueKey, title: track.title });
      if (!replay) {
        await queue.textChannel?.send(t('err.playback')).catch(() => {});
        await this.schedulePlayNext(queueKey, { naturalEnd: false });
      }
      return;
    }
    queue._streamSlotHeld = true;
    if (aborted()) {
      abortPlayback();
      return;
    }

    let enriched;
    const url = track.url ? normalizeMediaUrl(track.url) : '';
    const hasTitle = track.title?.trim() && !titleLooksLikeUrl(track.title, url);
    if (url && hasTitle && track.thumbnail) {
      enriched = { ...track, url };
      void resolveTrackMetadata(track).then((full) => {
        if (aborted() || queue.current !== enriched) return;
        if (full.durationSec && !queue.current.durationSec) {
          queue.current.durationSec = full.durationSec;
          this.updateNowPlaying(queueKey, queue.guild).catch(() => {});
        }
      }).catch(() => {});
    } else {
      enriched = await resolveTrackMetadata(track);
    }
    if (aborted()) {
      abortPlayback();
      return;
    }
    const startSec = enriched.startSec || 0;
    enriched.startedAt = Date.now();
    if (!replay && !enriched._streamRetries) enriched._streamRetries = 0;
    queue.lastFinishedTrack = null;
    queue.current = enriched;
    let resource = null;

    try {
      await this.sendNowPlaying(queueKey, queue.guild).catch(() => {});

      if (!ffmpegPath) {
        throw new Error('ffmpeg-static is not available');
      }

      const slaveKey = parseSlaveQueueKey(queueKey);
      const bridgeGuildId = slaveKey?.guildId || resolveGuildId();
      const slaveWithBridge = String(queueKey).startsWith('slave-')
        && Boolean(bridgeGuildId && isGuildBridgeRuntime(bridgeGuildId));
      let ytdlpErr = '';
      if (!isSafeMediaUrl(enriched.url)) {
        throw new Error('Blocked media URL');
      }
      // Always our own single-threaded ffmpeg -> PCM. Letting prism-media spawn its own
      // (Arbitrary input) costs an unbounded 18-thread ffmpeg per track and hits the
      // container PIDs limit at ~22 concurrent streams.
      const audioFilters = [...queue.filters];
      const ffmpegArgs = [
        '-hide_banner', '-loglevel', 'error',
        '-filter_threads', '1',
        '-analyzeduration', '0',
        '-probesize', '64k',
      ];
      if (startSec > 0) ffmpegArgs.push('-ss', String(startSec));
      ffmpegArgs.push('-i', 'pipe:0');
      if (audioFilters.length) {
        ffmpegArgs.push('-af', audioFilters.join(','));
      }
      // PCM out — Discord encodes to Opus; avoids muxer errors when stopping mid-stream.
      ffmpegArgs.push('-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
      // Pre-extracted info (prefetch.js) skips yt-dlp's extraction; retries always go cold.
      // Wait briefly for an in-flight extraction instead of killing it (faster first play).
      const infoFile = !replay && !enriched._ytdlpPlayerClient ? await prefetch.takeWait(enriched.url, 5000) : null;
      // ffmpeg first, then yt-dlp piped in the same tick: no early bytes are lost.
      const ffmpeg = await this.spawnFfmpegSafe(queue, ffmpegArgs);
      queue.ffmpegProcess = ffmpeg;

      // Plain spawn (not youtube-dl-exec/tinyspawn): tinyspawn buffers the whole stdout in memory
      // for its promise result — a full audio file per playing track.
      const ytdlpSource = infoFile ? ['--load-info-json', infoFile] : [enriched.url];
      const subprocessPromise = spawn(resolveYtdlpBinary(), [...ytdlpSource, ...ytdlpArgs({
        o: '-',
        q: '',
        ...ytdlpExecOptions({ playerClient: enriched._ytdlpPlayerClient }),
        f: slaveWithBridge ? 'bestaudio[abr<=96]/bestaudio/best' : 'bestaudio/best',
      })], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      if (infoFile) {
        console.log(`[MUSIC] Warm start (prefetched) "${enriched.title}" (${queueKey})`);
        // 'close' also fires after a spawn 'error' (where 'exit' may not).
        subprocessPromise.once('close', () => prefetch.release(infoFile));
      }
      subprocessPromise.stdout.pipe(ffmpeg.stdin);

      const logStreamFailure = (err, tag = 'stream') => {
        if (queue.subprocess !== subprocessPromise || queue.current !== enriched) return;
        const base = err?.message || String(err);
        const detail = ytdlpErr.trim();
        if (isYtdlp403Error(detail)) queue._lastStreamError403 = true;
        logMusicError(
          new Error(detail ? `${base}: ${detail}` : base),
          tag,
          {
            queueKey,
            url: enriched.url,
            title: enriched.title,
          },
        );
      };

      subprocessPromise.once('close', (code) => {
        // Killed on purpose (skip/stop/stall) -> code null; a real failure exits non-zero.
        if (code) logStreamFailure(new Error(`yt-dlp exited ${code}`));
      });
      queue.subprocess = subprocessPromise;

      // Stall watchdog: a CDN/network stall leaves the room silent forever. Killing yt-dlp ends the
      // track early; the Idle handler's early-failure path (retryCurrentTrack) resumes at the position.
      let lastBytesAt = Date.now();
      let streamEnded = false;
      subprocessPromise.stdout?.on('data', () => { lastBytesAt = Date.now(); });
      subprocessPromise.stdout?.once('end', () => { streamEnded = true; });
      const STALL_MS = Math.max(15_000, parseInt(process.env.MUSIC_STALL_MS || '40000', 10) || 40_000);
      const stallTimer = setInterval(() => {
        if (queue.subprocess !== subprocessPromise) { clearInterval(stallTimer); return; }
        if (streamEnded) { clearInterval(stallTimer); return; }
        // Paused playback back-pressures the pipe: no bytes is expected, not a stall.
        if (queue.player?.state?.status === AudioPlayerStatus.Paused
          || queue.player?.state?.status === AudioPlayerStatus.AutoPaused) {
          lastBytesAt = Date.now();
          return;
        }
        if (Date.now() - lastBytesAt < STALL_MS) return;
        clearInterval(stallTimer);
        console.warn(`[MUSIC] Stream stalled ${Math.round((Date.now() - lastBytesAt) / 1000)}s — restarting "${enriched.title}" (${queueKey})`);
        // Resume where the audio stopped, not where the wall clock is (position is wall-clock based).
        if (queue.current === enriched && enriched.startedAt) enriched.startedAt += Date.now() - lastBytesAt;
        // End our ffmpeg's input directly (an HLS yt-dlp may leave its own ffmpeg child holding the
        // pipe), then let yt-dlp clean up its children (SIGTERM) before forcing it.
        try { subprocessPromise.stdout.unpipe(ffmpeg.stdin); } catch { /* ignore */ }
        try { ffmpeg.stdin.end(); } catch { /* ignore */ }
        try { subprocessPromise.stdout.destroy(); } catch { /* ignore */ }
        try { subprocessPromise.kill('SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => {
          if (subprocessPromise.exitCode === null && subprocessPromise.signalCode === null) {
            try { subprocessPromise.kill('SIGKILL'); } catch { /* ignore */ }
          }
        }, 3000).unref?.();
      }, 5000);
      stallTimer.unref?.();
      subprocessPromise.once('exit', () => clearInterval(stallTimer));
      subprocessPromise.on('error', (err) => logStreamFailure(err));
      if (subprocessPromise.stderr) {
        subprocessPromise.stderr.on('data', (chunk) => {
          ytdlpErr = `${ytdlpErr}${chunk}`.slice(-800);
        });
      }
      if (subprocessPromise.stdout) {
        subprocessPromise.stdout.on('error', (err) => {
          if (queue.subprocess !== subprocessPromise) return;
          logMusicError(err, 'stream', {
            queueKey,
            url: enriched.url,
            title: enriched.title,
          });
        });
      }

      const finalStream = ffmpeg.stdout;
      const inputType = StreamType.Raw;
      {
        let ffmpegErr = '';
        ffmpeg.stderr?.on('data', (chunk) => {
          ffmpegErr = `${ffmpegErr}${chunk}`.slice(-800);
        });
        ffmpeg.on('error', (err) => {
          if (!ffmpeg.intentionalKill) {
            logMusicError(err, 'ffmpeg', {
              queueKey,
              url: enriched.url,
              title: enriched.title,
            });
          }
        });
        ffmpeg.on('close', (code) => {
          if (
            ffmpeg.intentionalKill
            || queue.suppressFfmpegFailure
            || queue.current !== enriched
          ) return;
          if (code === 0 || code === null) return;
          if (isYtdlp403Error(ytdlpErr)) queue._lastStreamError403 = true;
          logMusicError(new Error(`FFmpeg exited ${code}: ${ffmpegErr || '(no stderr)'}`), 'ffmpeg', {
            queueKey,
            url: enriched.url,
            title: enriched.title,
          });
          // Empty/invalid pipe from yt-dlp (403 etc.) is not a filter failure.
          if (audioFilters.length && !isYtdlp403Error(ytdlpErr)) {
            queue.filterPlaybackFailed = true;
          }
        });
        ffmpeg.stdout?.on('error', (err) => {
          if (queue.ffmpegProcess !== ffmpeg) return;
          logMusicError(err, 'ffmpeg', { queueKey, title: enriched.title });
        });
        ffmpeg.stdin?.on('error', (err) => {
          if (queue.ffmpegProcess !== ffmpeg) return;
          logMusicError(err, 'ffmpeg', { queueKey, title: enriched.title });
        });
      }

      if (aborted()) {
        abortPlayback();
        return;
      }

      // Opus encode runs on worker threads so many streams don't delay voice packets
      // (MUSIC_ENCODE_POOL=0 restores the in-process encoder).
      if (process.env.MUSIC_ENCODE_POOL !== '0') {
        const encoded = encodeStream(finalStream, this.volumeGain(queue));
        resource = createAudioResource(encoded, { inputType: StreamType.Opus });
        resource.volume = { setVolume: (gain) => encoded.setVolume(gain) };
      } else {
        resource = createAudioResource(finalStream, {
          inputType,
          inlineVolume: true,
        });
      }
      if (resource.playStream) {
        resource.playStream.on('error', (err) => {
          logMusicError(err, 'stream', {
            queueKey,
            url: enriched.url,
            title: enriched.title,
          });
        });
      }
      this.applyResourceVolume(queue, resource);
      if (aborted()) {
        try { resource.playStream?.destroy(); } catch { /* ignore */ }
        abortPlayback();
        return;
      }
      queue.player.play(resource);
      queue.skipIdleOnce = false;

      if (queue.afterReplayPause) {
        queue.player.pause();
        enriched.pausedAt = Date.now();
        queue.afterReplayPause = false;
      }
    } catch (err) {
      this.killProcesses(queue);
      if (resource && queue.player?.state?.resource !== resource) {
        try { resource.playStream?.destroy(); } catch { /* ignore */ }
      }
      logMusicError(err, 'playback', {
        queueKey,
        url: enriched?.url,
        title: enriched?.title,
      });
      if (replay) {
        queue.current = enriched;
        await queue.textChannel?.send(t('mgr.seekFail')).catch(() => {});
        return;
      }
      if (aborted()) return;
      await queue.textChannel?.send(t('err.playback')).catch(() => {});
      await this.schedulePlayNext(queueKey, { naturalEnd: false });
      return;
    }

    if (aborted()) {
      abortPlayback();
      return;
    }
    if (queue.guild) await this.refreshListeners(queue, queue.guild).catch(() => {});
    try {
      await this.sendNowPlaying(queueKey, queue.guild);
    } catch (err) {
      logMusicError(err, 'nowplaying-ui', {
        queueKey,
        url: enriched?.url,
        title: enriched?.title,
      });
    }
    this.startProgressTicker(queueKey);
    this.prefetchNext(queue);
    } finally {
      queue._playbackStarting = false;
    }
  }

  static async restartCurrentWithFilter(queueKey) {
    const queue = this.getQueue(queueKey);
    if (!queue.current) return false;

    const wasPaused = queue.player.state.status === AudioPlayerStatus.Paused;
    const duration = queue.current.durationSec || 0;
    let pos = this.getPlaybackPosition(queue);
    if (duration > 0) pos = Math.min(Math.max(0, duration - 0.5), pos);

    const track = {
      ...queue.current,
      startSec: pos,
      startedAt: undefined,
      pausedAt: undefined,
    };

    queue.afterReplayPause = wasPaused;
    queue.skipIdleOnce = true;
    queue.replayTrack = track;
    this.killProcesses(queue);
    await this.waitForProcessesDown(queue);

    if (queue.player.state.status !== AudioPlayerStatus.Idle) {
      queue.player.stop();
      return true;
    }

    queue.skipIdleOnce = false;
    queue.replayTrack = null;
    await this.playTrack(queueKey, track, { replay: true });
    return true;
  }

  /** Warm the next track's stream info so the gap between tracks is ~1 s instead of a cold extraction. */
  static prefetchNext(queue) {
    if (queue.loop === 'track') return;
    this.topUpAutoDj(queue, queue._key ?? null);
    const next = queue.tracks[0];
    if (!next?.url) return;
    try { prefetch.prefetch(normalizeMediaUrl(next.url)); } catch { /* best effort */ }
  }

  static startProgressTicker(queueKey) {
    const queue = this.getQueue(queueKey);
    if (queue.progressInterval) clearInterval(queue.progressInterval);
    queue.progressInterval = setInterval(() => {
      if (!queue.current || !queue.nowPlayingMsg) {
        clearInterval(queue.progressInterval);
        queue.progressInterval = null;
        return;
      }
      this.updateNowPlaying(queueKey).catch(() => {});
      // Tracks queued after this one started get warmed too (cached URLs are no-ops).
      this.prefetchNext(queue);
    }, 20_000);
  }

  static async updateNowPlaying(queueKey, guild) {
    const queue = this.getQueue(queueKey);
    if (!queue.current || !queue.textChannel) return;
    if (queue.activeFilter && !FILTER_PRESETS[queue.activeFilter]) {
      this.setFilter(queue, 'none');
    }
    if (guild) await this.refreshListeners(queue, guild);

    const saved = this.getSavedPlaylists(queueKey);
    const embed = buildNowPlayingEmbed(queue, queueKey);
    const components = buildControls(queue, queueKey, saved);
    if (queue.nowPlayingMsg) {
      await discordMessageEdit(queue.nowPlayingMsg, { embeds: [embed], components }).catch(() => {});
    }
  }

  static async prepareNowPlayingSlot(queue, message) {
    if (!message) return;
    queue.nowPlayingMsg = message;
    await message.edit({ content: t('mgr.starting'), embeds: [], components: [] }).catch(() => {});
  }

  static async sendNowPlaying(queueKey, guild, { forceNew = false } = {}) {
    const queue = this.getQueue(queueKey);
    if (!queue.current || !queue.textChannel) return;
    if (guild) await this.refreshListeners(queue, guild);

    const saved = this.getSavedPlaylists(queueKey);
    const embed = buildNowPlayingEmbed(queue, queueKey);
    const components = buildControls(queue, queueKey, saved);
    const payload = { content: null, embeds: [embed], components };

    const sendFresh = forceNew || queue.forceNewNowPlaying;
    if (queue.forceNewNowPlaying) queue.forceNewNowPlaying = false;

    if (!sendFresh && queue.nowPlayingMsg) {
      try {
        await discordMessageEdit(queue.nowPlayingMsg, payload);
        return;
      } catch {
        queue.nowPlayingMsg = null;
      }
    }
    queue.nowPlayingMsg = await discordMessageSend(queue.textChannel, payload);
  }

  static async clearNowPlayingUI(queue) {
    if (queue.nowPlayingMsg) {
      await queue.nowPlayingMsg.edit({ components: [] }).catch(() => {});
      queue.nowPlayingMsg = null;
    }
  }

  /** Freeze current Now Playing as Finished + Play now, then detach for a fresh NP message. */
  static async finalizeNowPlayingMessage(queue, queueKey, finishedTrack) {
    if (!finishedTrack || !queue.nowPlayingMsg) return;
    if (queue.guild) await this.refreshListeners(queue, queue.guild).catch(() => {});

    const embed = buildFinishedNowPlayingEmbed(queue, queueKey, finishedTrack);
    const components = buildFinishedControls(queueKey, finishedTrack);
    if (!embed) return;

    const payload = { content: null, embeds: [embed], components };
    await discordMessageEdit(queue.nowPlayingMsg, payload).catch(() => {});
    queue.nowPlayingMsg = null;
    queue.lastFinishedTrack = finishedTrack;
  }

  static async showFinishedNowPlayingUI(queue, queueKey, track) {
    if (!track || !queue.textChannel) return;
    if (queue.guild) await this.refreshListeners(queue, queue.guild);

    const embed = buildFinishedNowPlayingEmbed(queue, queueKey, track);
    const components = buildFinishedControls(queueKey, track);
    if (!embed) return;

    const payload = { content: null, embeds: [embed], components };
    if (queue.nowPlayingMsg) {
      await discordMessageEdit(queue.nowPlayingMsg, payload).catch(() => {});
    } else {
      await discordMessageSend(queue.textChannel, payload);
    }
    queue.nowPlayingMsg = null;
  }

  static async haltGuildPlayback(queueKey) {
    const queue = this.getQueue(queueKey);
    this.cancelPendingSeek(queueKey, queue);
    const shouldClearUi = Boolean(queue.current)
      || this.hasActivePlayback(queue, queue.player);
    if (queue.current) this.recordPlayedTrack(queue, queueKey, queue.current);
    queue.suppressQueueFinished = true;
    queue.tracks = [];
    queue.loop = 'none';
    queue.skipVotes.clear();
    queue._playToken = (queue._playToken || 0) + 1;
    queue._playbackStarting = false;
    queue.skipIdleOnce = true;
    queue.replayTrack = null;
    queue.lastFinishedTrack = null;
    queue.current = null;
    this.killProcesses(queue);
    if (queue.player?.state?.status !== AudioPlayerStatus.Idle) {
      queue.player?.stop();
    }
    if (shouldClearUi) {
      await this.clearNowPlayingUI(queue).catch(() => {});
    } else {
      queue.nowPlayingMsg = null;
    }
  }

  static async haltAllPlayback() {
    const keys = [...queues.keys()];
    await Promise.all(keys.map((k) => this.haltGuildPlayback(k)));
  }

  static setFilter(queue, filterKey) {
    if (!FILTER_PRESETS[filterKey]) filterKey = 'none';
    queue.activeFilter = filterKey;
    const preset = FILTER_PRESETS[filterKey];
    queue.filters = [...(preset.filters || [])];
  }

  static async transferRoomOwner(queue, newOwnerId, guild) {
    if (!newOwnerId || !guild) return false;
    this.syncRoomRoster(queue, guild);
    const ch = guild.channels.cache.get(queue.voiceChannelId);
    const humanIds = this.humanMemberIds(ch);
    if (!humanIds.includes(newOwnerId) || newOwnerId === queue.roomOwnerId) return false;

    const previousOwnerId = queue.roomOwnerId;
    if (!queue.joinOrder) queue.joinOrder = [];
    queue.joinOrder = queue.joinOrder.filter(id => id !== newOwnerId);
    queue.joinOrder.unshift(newOwnerId);
    queue.roomOwnerId = newOwnerId;
    await this.announceNewOwner(queue, newOwnerId, { previousOwnerId });
    return true;
  }

  static getTransferCandidates(queue, guild) {
    if (!guild || !queue.roomOwnerId) return [];
    this.syncRoomRoster(queue, guild);
    const ch = guild.channels.cache.get(queue.voiceChannelId);
    return this.humanMemberIds(ch).filter(id => id !== queue.roomOwnerId);
  }

  static async replayCurrentTrack(queueKey, { startSec = 0 } = {}) {
    const queue = this.getQueue(queueKey);
    if (!queue.current) return false;

    const wasPaused = queue.player.state.status === AudioPlayerStatus.Paused;
    const track = {
      ...queue.current,
      startSec,
      startedAt: undefined,
      pausedAt: undefined,
    };

    queue.afterReplayPause = wasPaused;
    queue.skipIdleOnce = true;
    queue.replayTrack = track;
    this.killProcesses(queue);
    await this.waitForProcessesDown(queue);

    if (queue.player.state.status !== AudioPlayerStatus.Idle) {
      queue.player.stop();
      return true;
    }

    queue.skipIdleOnce = false;
    queue.replayTrack = null;
    await this.playTrack(queueKey, track, { replay: true });
    return true;
  }

  static loopModeLabel(loop) {
    if (loop === 'none') return t('mgr.loopOff');
    if (loop === 'queue') return t('mgr.loopQueue');
    return t('mgr.loopTrack');
  }

  static cycleLoop(queue) {
    if (queue.loop === 'none') queue.loop = 'queue';
    else if (queue.loop === 'queue') queue.loop = 'track';
    else queue.loop = 'none';
    return queue.loop;
  }

  static resolveAutoDjMood(arg) {
    if (!arg) return null;
    const { AUTO_DJ_MOODS } = require('./musicUI');
    const lower = arg.toLowerCase();
    const byKey = AUTO_DJ_MOODS.find(m => m.key === lower);
    if (byKey) return byKey.id;
    const byId = AUTO_DJ_MOODS.find(m => m.id.toLowerCase().includes(lower));
    if (byId) return byId.id;
    return arg;
  }

  static prepareAutoDjStart(queue, queueKey, getVoiceFn, arg = null) {
    if (arg) {
      queue.autoDj.query = this.resolveAutoDjMood(arg);
      queue.autoDj.mode = 'mood';
    } else {
      queue.autoDj.mode = 'similar';
    }
    queue.autoDj.enabled = true;
    const { moodLabelFromId } = require('./musicUI');
    const moodLabel = queue.autoDj.mode === 'similar'
      ? t('music.mood.similar')
      : moodLabelFromId(queue.autoDj.query);
    this.syncVoiceFromClient(queueKey, getVoiceFn);
    if (!queue.player) {
      return { content: t('music.voiceNotReady'), scheduleUpdate: false };
    }
    if (this.isTrackLoading(queue)) {
      return { content: t('mgr.autoDjStarting', { query: moodLabel }), scheduleUpdate: false };
    }
    if (this.maybeStartAutoDj(queueKey)) {
      return { content: t('mgr.autoDjStarting', { query: moodLabel }), scheduleUpdate: false };
    }
    if (this.hasActivePlayback(queue, queue.player)) {
      return { content: t('mgr.autoDjOn', { query: moodLabel }), scheduleUpdate: false };
    }
    this.ensurePlayerEvents(queueKey);
    this.armMusicPlayback(queue);
    void this.schedulePlayNext(queueKey);
    return { content: t('mgr.autoDjStarting', { query: moodLabel }), scheduleUpdate: true };
  }

  static async startAutoDjText(message, queue, queueKey, guild, arg, getVoiceFn) {
    const { content, scheduleUpdate } = this.prepareAutoDjStart(queue, queueKey, getVoiceFn, arg);
    await message.reply(content);
    if (scheduleUpdate) {
      setTimeout(() => this.updateNowPlaying(queueKey, guild).catch(() => {}), 2500);
    }
  }

  static async stopPlayback(queue, queueKey, guild) {
    this.cancelPendingSeek(queueKey, queue);
    queue._streamingCancel = (queue._streamingCancel || 0) + 1; // stop background streaming-link matching
    const lastTrack = queue.current ? { ...queue.current } : null;
    if (queue.current) this.recordPlayedTrack(queue, queueKey, queue.current);
    queue.suppressQueueFinished = true;
    queue.tracks = [];
    queue.loop = 'none';
    queue.skipVotes.clear();
    queue._playToken = (queue._playToken || 0) + 1;
    queue._playbackStarting = false;
    queue.skipIdleOnce = true;
    queue.replayTrack = null;
    queue.current = null;
    this.killProcesses(queue);
    if (queue.player?.state?.status !== AudioPlayerStatus.Idle) {
      queue.player?.stop();
    }
    if (lastTrack) {
      queue.lastFinishedTrack = lastTrack;
      await this.showFinishedNowPlayingUI(queue, queueKey, lastTrack);
    } else {
      queue.lastFinishedTrack = null;
      await this.clearNowPlayingUI(queue);
    }
    if (guild) void this.refreshListeners(queue, guild);
  }

  static async _resolveVoteSkip(member, guild, queue, queueKey) {
    if (!member) {
      return { content: t('music.notInVoice'), skipped: false };
    }
    const guildId = guild?.id ?? queue.guild?.id;
    const { isVoteToSkipEnabled } = require('../panel/musicSkipSettings');
    if (!isVoteToSkipEnabled(queueKey, guildId)) {
      this.skipCurrent(queue, queueKey);
      return { content: t('mgr.skipped'), skipped: true };
    }

    const channel = guild?.channels.cache.get(queue.voiceChannelId)
      ?? member?.voice?.channel;
    if (!channel?.isVoiceBased?.()) {
      this.skipCurrent(queue, queueKey);
      return { content: t('mgr.skipped'), skipped: true };
    }

    if (guild) this.syncRoomRoster(queue, guild);

    if (queue.roomOwnerId === member?.id) {
      this.skipCurrent(queue, queueKey);
      return { content: t('mgr.skipOwner'), skipped: true, ephemeral: true };
    }

    const humans = [...channel.members.values()].filter(m => !m.user.bot);
    if (humans.length < 2) {
      this.skipCurrent(queue, queueKey);
      return { content: t('mgr.skipped'), skipped: true };
    }

    queue.skipVotes.add(member.id);
    const needed = Math.ceil(humans.length / 2);
    if (queue.skipVotes.size >= needed) {
      this.skipCurrent(queue, queueKey);
      return {
        content: t('mgr.skipVote', { votes: queue.skipVotes.size, needed }),
        skipped: true,
      };
    }

    return {
      content: t('mgr.voteSkip', { votes: queue.skipVotes.size, needed }),
      skipped: false,
    };
  }

  static async voteSkipMessage(message, queue, queueKey) {
    if (this.isNothingPlaying(queue)) {
      await message.reply(t('mgr.nothingPlay'));
      return false;
    }
    const member = message.member
      ?? await message.guild.members.fetch(message.author.id).catch(() => null);
    const result = await this._resolveVoteSkip(member, message.guild, queue, queueKey);
    await message.reply(result.content);
    return result.skipped;
  }

  /** T62: text versions of the player buttons (pause, resume, now playing, queue, shuffle, remove, clear, seek). */
  static async cmdTextControl(message, queue, queueKey, guild, { action, arg }) {
    const { formatDuration } = require('./musicUI');
    const refresh = () => this.updateNowPlaying(queueKey, guild).catch(() => {});
    switch (action) {
      case 'pause':
        if (queue.player?.state?.status !== AudioPlayerStatus.Playing) return message.reply(t('mgr.alreadyPaused'));
        queue.player.pause();
        if (queue.current) queue.current.pausedAt = Date.now();
        await refresh();
        return message.reply(t('mgr.paused'));
      case 'resume':
        if (queue.player?.state?.status !== AudioPlayerStatus.Paused) return message.reply(t('mgr.notPaused'));
        if (queue.current?.pausedAt) {
          queue.current.startedAt += Date.now() - queue.current.pausedAt;
          queue.current.pausedAt = null;
        }
        queue._autoPaused = false;
        queue.player.unpause();
        await refresh();
        return message.reply(t('mgr.resumed'));
      case 'np':
        await this.sendNowPlaying(queueKey, guild, { forceNew: true });
        return null;
      case 'queue':
        return this.showQueue(message, queueKey);
      case 'shuffle': {
        if (queue.tracks.length < 2) return message.reply(t('mgr.queueTooShort'));
        for (let i = queue.tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
        }
        await refresh();
        return message.reply(t('mgr.shuffled'));
      }
      case 'remove': {
        const removed = this.removeFromQueue(queue, parseInt(arg, 10));
        if (!removed) return message.reply(t('mgr.badIndex', { n: queue.tracks.length }));
        await refresh();
        return message.reply(t('mgr.removedOne', { title: removed.title }));
      }
      case 'clear': {
        const n = queue.tracks.length;
        queue.tracks.length = 0;
        await refresh();
        return message.reply(t('mgr.cleared', { n }));
      }
      case 'seek':
      case 'back': {
        const pos = this.getPlaybackPosition(queue);
        let delta;
        if (arg.includes(':')) {
          const [m, s] = arg.split(':').map(Number);
          delta = (m * 60 + s) - pos;
        } else {
          delta = Number(arg) * (action === 'back' ? -1 : 1);
        }
        const to = await this.seekCurrent(queueKey, delta);
        if (to === null || !queue.current) return message.reply(t('mgr.seekFail'));
        return message.reply(t('mgr.seekPos', { pos: formatDuration(to), total: formatDuration(queue.current.durationSec || 0) }));
      }
      default:
        return null;
    }
  }

  static async cmdVolumeText(message, queue, queueKey, guild, arg, cap = 200) {
    if (!arg) {
      const vol = queue.volume ?? 100;
      return message.reply(t('mgr.volNow', { vol }));
    }
    const n = parseInt(arg, 10);
    if (Number.isNaN(n)) {
      return message.reply(t('mgr.volInvalid'));
    }
    const vol = this.setMusicVolume(queue, Math.min(n, cap));
    await this.updateNowPlaying(queueKey, guild);
    return message.reply(n > cap ? t('perm.volumeCapped', { vol }) : t('mgr.volume', { vol }));
  }

  static async tryVoteSkip(interaction, queue, queueKey) {
    if (this.isNothingPlaying(queue)) {
      await interaction.reply({ content: t('mgr.nothingPlay'), flags: Ephemeral });
      return false;
    }
    const result = await this._resolveVoteSkip(interaction.member, interaction.guild, queue, queueKey);
    await interaction.reply({
      content: result.content,
      flags: result.ephemeral ? Ephemeral : undefined,
    });
    return result.skipped;
  }

  static async handleInteraction(interaction, queueKey, guild, getVoice) {
    const { handleMusicInteraction } = require('./musicInteractions');
    return handleMusicInteraction(interaction, queueKey, guild, getVoice);
  }

  static async showQueue(message, queueKey) {
    const queue = this.getQueue(queueKey);
    await message.reply(buildQueuePayload(queue, queueKey));
  }

  static async showStats(message, queueKey) {
    const queue = this.getQueue(queueKey);
    await message.reply({ embeds: [buildStatsEmbed(queue, queueKey)] });
  }

  static async showHistory(message, queueKey) {
    const queue = this.getQueue(queueKey);
    this.syncHistory(queue, queueKey);
    const embed = buildHistoryEmbed(queue, queueKey);
    if (!queue.history.length) {
      return message.reply({ embeds: [embed] });
    }
    await message.reply({ embeds: [embed] });
  }

  static async showHelp(message, queueKey) {
    await message.reply({ embeds: [buildHelpEmbed(queueKey)] });
  }

  static buildLyricsEmbed(track, lyrics, source = 'unknown') {
    const text = lyrics.length > 4000 ? `${lyrics.slice(0, 3997)}...` : lyrics;
    return new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📝 ${track.title}`)
      .setURL(track.url || null)
      .setDescription(text)
      .setFooter({ text: t('mgr.lyricsSource', { source }) });
  }

  static async cmdLyrics(target, queue, { isInteraction = false } = {}) {
    if (!queue.current) {
      const msg = t('mgr.nothingPlay');
      if (isInteraction) {
        if (target.deferred || target.replied) return target.editReply(msg);
        return target.reply({ content: msg, flags: Ephemeral });
      }
      return target.reply(msg);
    }

    const track = queue.current;

    let replyMsg;
    if (isInteraction) {
      await target.deferReply({ flags: Ephemeral });
    } else {
      replyMsg = await target.reply(t('mgr.searching'));
    }

    let result = { lyrics: null, source: null };
    try {
      result = await findLyrics(track.title, track.durationSec);
    } catch (err) {
      console.error('[LYRICS] Error:', err);
    }

    if (!result.lyrics) {
      const msg = t('mgr.lyricsNotFound');
      if (isInteraction) return target.editReply(msg);
      return replyMsg.edit(msg);
    }

    const embed = this.buildLyricsEmbed(track, result.lyrics, result.source);
    if (isInteraction) return target.editReply({ embeds: [embed] });
    return replyMsg.edit({ content: null, embeds: [embed] });
  }

  static toggleAutoDj(queue, query) {
    if (query) {
      queue.autoDj.query = query;
      queue.autoDj.mode = 'mood';
    }
    queue.autoDj.enabled = !queue.autoDj.enabled;
    return queue.autoDj;
  }

  static removeFromQueue(queue, index) {
    const i = index - 1;
    if (i < 0 || i >= queue.tracks.length) return null;
    return queue.tracks.splice(i, 1)[0];
  }

  static moveQueueTrack(queue, index, direction) {
    const i = index - 1;
    if (i < 0 || i >= queue.tracks.length) return null;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= queue.tracks.length) return null;
    [queue.tracks[i], queue.tracks[j]] = [queue.tracks[j], queue.tracks[i]];
    return j + 1;
  }

  /** Move a waiting track to the front and play it now (skips current if playing). */
  static jumpToQueueTrack(queue, queueKey, index) {
    const i = index - 1;
    if (i < 0 || i >= queue.tracks.length) return null;
    const [track] = queue.tracks.splice(i, 1);
    queue.tracks.unshift(track);

    const playing = queue.current
      && queue.player?.state?.status
      && queue.player.state.status !== AudioPlayerStatus.Idle;

    if (playing) {
      this.skipCurrent(queue, queueKey);
      return { track, needsStart: false };
    }

    return { track, needsStart: true };
  }

  static collectForSave(queue) {
    const strip = (t) => ({
      title: t.title,
      url: t.url,
      thumbnail: t.thumbnail,
      durationSec: t.durationSec,
    });
    if (queue.tracks.length) {
      return { tracks: queue.tracks.map(strip), mode: 'queue' };
    }
    if (queue.current) {
      return { tracks: [strip(queue.current)], mode: 'now' };
    }
    return { tracks: [], mode: 'empty' };
  }

  static async cmdSaveHelp(message, queueKey) {
    const queue = this.getQueue(queueKey);
    const { tracks, mode } = this.collectForSave(queue);
    const embed = buildSavePreviewEmbed(queueKey, tracks, mode);
    const components = buildPlaylistManagerRows(this.getSavedPlaylists(queueKey), queueKey);
    return message.reply({ embeds: [embed], components });
  }

  static async cmdSave(message, queueKey, name) {
    const queue = this.getQueue(queueKey);
    const { tracks, mode } = this.collectForSave(queue);
    if (!tracks.length) return this.cmdSaveHelp(message, queueKey);

    const { displayName, count } = playlistStore.save(queueKey, name, tracks);
    const embed = buildSaveSuccessEmbed(queueKey, displayName, count, tracks, mode);
    await message.reply({ embeds: [embed] });
    await this.updateNowPlaying(queueKey, queue.guild);
  }

  static async cmdPlayModal(interaction, queueKey, { player, connection, voiceChannelId }) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const query = interaction.fields.getTextInputValue('play_query').trim();
    if (!query) {
      return interaction.editReply({ content: t('music.pl.addFirst', { cmd: cmd() }) });
    }
    if (!player || !connection) {
      return interaction.editReply({ content: t('music.voiceNotReady') });
    }

    const loading = { edit: (payload) => interaction.editReply(payload) };
    await loading.edit(t('mgr.searching'));

    const fauxMessage = {
      id: interaction.id,
      author: interaction.user,
      channel: interaction.channel,
      guild: interaction.guild,
      reply: (payload) => interaction.editReply(payload),
    };

    try {
      await this.handlePlay(
        fauxMessage, query, player, connection, queueKey, voiceChannelId, { loading },
      );
    } catch (err) {
      if (!isUnknownInteraction(err)) {
        logMusicError(err, 'search', { queueKey });
        await interaction.editReply(formatMusicError(err, 'search')).catch(() => {});
      }
    }
  }

  static async cmdSaveModal(interaction, queueKey) {
    const name = interaction.fields.getTextInputValue('playlist_name');
    const queue = this.getQueue(queueKey);
    const { tracks, mode } = this.collectForSave(queue);

    if (!tracks.length) {
      await interaction.reply({
        content: t('mgr.noSave', { cmd: cmd() }),
        flags: Ephemeral,
      });
      return;
    }

    const { displayName, count } = playlistStore.save(queueKey, name, tracks);
    const embed = buildSaveSuccessEmbed(queueKey, displayName, count, tracks, mode);
    await interaction.reply({ embeds: [embed], flags: Ephemeral });
    await this.updateNowPlaying(queueKey, interaction.guild);
  }

  static async cmdLoad(message, queueKey, name, player, { quiet = false } = {}) {
    const queue = this.getQueue(queueKey);
    this.bindQueueContext(queue, { player, message });

    const entry = playlistStore.getEntry(queueKey, name);
    if (!entry?.tracks?.length) {
      const embed = buildSavePreviewEmbed(queueKey, [], 'empty');
      embed.setTitle(t('mgr.plNotFound'));
      embed.setDescription(t('mgr.noPlName', { name }));
      return message.reply({ embeds: [embed] });
    }

    const { added, skipped } = this.enqueueTracks(queue, entry.tracks, message.author, queueKey);
    const started = await this.startPlaybackIfIdle(queueKey, player);

    if (quiet && started) {
      return message.reply(t('mgr.nowPlaying', { title: entry.displayName }));
    }

    const embed = buildLoadSuccessEmbed(queueKey, entry, added, skipped);
    if (started && !added.length) {
      embed.setDescription(t('mgr.nowPlaying', { title: entry.displayName }));
    }
    await message.reply({ embeds: [embed] });
    if (!started) await this.afterEnqueue(queueKey, player);
  }

  static playlistManagerPayload(queueKey) {
    const queue = this.getQueue(queueKey);
    this.syncHistory(queue, queueKey);
    const items = this.getSavedPlaylists(queueKey);
    return buildLibraryPayload(queue, queueKey, items);
  }

  static async replyPlaylistManager(interaction, queueKey, isUpdate = false) {
    const payload = this.playlistManagerPayload(queueKey);
    if (isUpdate) {
      await interaction.update({ ...payload, content: null });
    } else if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ ...payload, flags: Ephemeral });
    } else {
      await interaction.reply({ ...payload, flags: Ephemeral });
    }
  }

  static async cmdLists(message, queueKey) {
    return message.reply(this.playlistManagerPayload(queueKey));
  }

  static async cmdViewPlaylist(message, queueKey, name) {
    const entry = playlistStore.getEntry(queueKey, name);
    if (!entry?.tracks?.length) {
      return message.reply(t('mgr.noPlName', { name }));
    }
    const embed = buildPlaylistDetailEmbed(queueKey, entry);
    return message.reply({ embeds: [embed] });
  }

  static async cmdDeletePlaylist(message, queueKey, name) {
    const entry = playlistStore.getEntry(queueKey, name);
    if (!entry || !playlistStore.remove(queueKey, name)) {
      return message.reply(t('mgr.noPlName', { name }));
    }
    return message.reply(t('mgr.deletedPl', { name: entry.displayName }));
  }

  static async cmdRemoveFromSaved(message, queueKey, name, index) {
    const result = playlistStore.removeTrack(queueKey, name, index);
    if (!result) {
      const entry = playlistStore.getEntry(queueKey, name);
      if (!entry) {
        return message.reply(t('mgr.noPlName', { name }));
      }
      return message.reply(t('mgr.cantRemove'));
    }

    if (result.playlistDeleted) {
      return message.reply(t('mgr.removedEmpty', { title: result.removed.title }));
    }

    return message.reply(t('mgr.deletedPl', { name: result.removed.title }));
  }

  static async cmdClearPlaylists(message, queueKey) {
    const count = this.getSavedPlaylists(queueKey).length;
    if (!count) return message.reply(t('music.empty.playlistShort'));
    playlistStore.clearAll(queueKey);
    return message.reply(t('mgr.clearedAll', { count }));
  }

  static resolveDefaultPlaylistName(queueKey, envDefault) {
    if (envDefault) return envDefault;
    const stored = playlistStore.getDefault(queueKey);
    if (stored) return stored;
    return 'main';
  }

  static async cmdPlayDefault(message, queueKey, player, envDefault) {
    const queue = this.getQueue(queueKey);
    this.bindQueueContext(queue, { player, message });
    this.ensurePlayerEvents(queueKey);

    // Track active → resend controls (new message, like `np`)
    if (this.hasActivePlayback(queue, player)) {
      if (player.state.status === AudioPlayerStatus.Paused) {
        if (queue.current.pausedAt) {
          queue.current.startedAt += Date.now() - queue.current.pausedAt;
          queue.current.pausedAt = null;
        }
        player.unpause();
      }
      return this.resendMusicUI(message, queueKey);
    }

    // Idle with songs waiting → start without reloading
    if (player.state.status === AudioPlayerStatus.Idle && queue.tracks.length) {
      const waiting = queue.tracks.length;
      await this.schedulePlayNext(queueKey);
      return message.reply(t('mgr.starting'));
    }

    this.syncHistory(queue, queueKey);
    const items = this.getSavedPlaylists(queueKey);

    if (!queue.history.length && !items.length) {
      const embed = buildSavePreviewEmbed(queueKey, [], 'empty');
      embed.setTitle(t('music.choose.title', { emoji: '🎵' }));
      embed.setDescription(t('music.pl.addFirst', { cmd: cmd() }));
      const payload = buildChoosePayload(queue, queueKey, items);
      return message.reply(payload);
    }

    return message.reply(buildChoosePayload(queue, queueKey, items));
  }

  static async cmdSetDefault(message, queueKey, name) {
    const displayName = playlistStore.setDefault(queueKey, name);
    if (!displayName) {
      return message.reply(t('mgr.noPlName', { name }));
    }
    return message.reply(t('mgr.defaultPl', { name: displayName }));
  }
}

// T61: pause music in empty rooms, resume when someone joins.
require('./emptyRoom').start(MusicManager, queues);

MusicManager.MAX_QUEUE = MAX_QUEUE;
module.exports = MusicManager;
