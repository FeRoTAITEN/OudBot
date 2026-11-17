const { t, getLang } = require('../i18n/context');
const { playCommand } = require('../i18n');
const { Ephemeral } = require('../util/interactionFlags');
const { logDiscordFailure } = require('../util/logger');
const { EmbedBuilder } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const MusicManager = require('./MusicManager');
const playlistStore = require('./playlistStore');
const historyStore = require('./historyStore');
const yts = require('./youtubeSearch');
const { isYouTubeMixList } = require('./youtubeSearch');
const { resolveTrackMetadata, extractVideoId } = require('./youtubeMeta');
const {
  formatMusicError,
  formatMixPlaylistError,
  logMusicError,
  isUnknownInteraction,
  isInteractionAcknowledged,
} = require('./musicErrors');
const {
  buildMenuPayload,
  buildControlsSubPagePayload,
  buildLoadSuccessEmbed,
  buildPlaylistEditPayload,
  buildPlaylistDetailEmbed,
  buildDeleteConfirmRow,
  buildClearConfirmRow,
  buildStopConfirmRow,
  STOP_CONFIRM_OVER,
  buildClearHistoryConfirmRow,
  buildHistoryEmbed,
  buildHistoryPayload,
  buildHistoryPlayRow,
  buildAutoDjPayload,
  buildStatsEmbed,
  buildQueuePayload,
  buildTransferSelectRow,
  buildVideoOnlyRow,
  themeFor,
  filterLabel,
  moodLabelFromId,
  isMusicMenuMessage,
  npUiSizeLabel,
  formatDuration,
  addedQueueText,
  queuePageFor,
  pageForTrackIndex,
  TRACK_REMOVE_PAGE_SIZE,
  parseMusicId,
} = require('./musicUI');
const { cycleNpUiSize } = require('./npUiSettings');
const { parseSlaveQueueKey } = require('./slaveQueueKey');
const { musicQueueKeyMatches } = require('./queueKey');
const { discordGate } = require('../web/memberAccess');

function cmd() {
  return playCommand(getLang());
}

function loopModeLabel(loop) {
  if (loop === 'none') return t('mgr.loopOff');
  if (loop === 'queue') return t('mgr.loopQueue');
  return t('mgr.loopTrack');
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function discordCatch(tag, context) {
  return (err) => logDiscordFailure(tag, err, context);
}

async function handleMusicInteraction(interaction, queueKey, guild, getVoice) {
const parsed = parseMusicId(interaction.customId);
if (!parsed || !musicQueueKeyMatches(parsed.queueKey, queueKey, guild?.id)) return false;

const queue = MusicManager.getQueue(queueKey);
MusicManager.syncVoiceFromClient(queueKey, getVoice);
if (interaction.channel) queue.textChannel = interaction.channel;
if (guild) queue.guild = guild;

// Member levels (same as the dashboard): in the bot's room, DJ, room owner, Manage Server; blocked users denied.
const gate = guild ? discordGate(interaction.member, guild, queue, parsed.action) : { ok: true, level: 'admin' };
if (!gate.ok) {
  await interaction.reply({ content: t(gate.reason), flags: Ephemeral }).catch(discordCatch('MUSIC', 'interaction'));
  return true;
}
if (guild) { try { require('../web/audit').recordDiscord(interaction.member, queueKey, parsed.action); } catch { /* audit is best-effort */ } }
const uiOnly = [
  'menu', 'savepl', 'playlists', 'loadpl', 'loadhist', 'editpl', 'delpl', 'rmtrack', 'editpage',
  'rmqueue', 'playqueue', 'movepick', 'moveup', 'movedown', 'queue', 'qpage',
  'autodj', 'autodjtoggle', 'autodjmood', 'skipmode', 'skipmodetoggle', 'npui', 'menucontrols', 'menuback', 'startautodj', 'stats', 'pick', 'urlpick', 'playsearch',
  'clearask', 'del_yes', 'del_no', 'clearyes', 'clearno', 'stopno',
  'clearhistask', 'clearhistyes', 'clearhistno',
  'transfer', 'transferpick', 'history', 'replaylast',
];

if (!uiOnly.includes(parsed.action) && MusicManager.isNothingPlaying(queue)) {
  await interaction.reply({ content: t('mgr.nothingPlay'), flags: Ephemeral }).catch(discordCatch('MUSIC', 'interaction'));
  return true;
}

if (parsed.action === 'stop' && (queue.tracks?.length || 0) > STOP_CONFIRM_OVER) {
  await interaction.reply({
    content: t('mgr.stopAsk', { count: queue.tracks.length }),
    components: [buildStopConfirmRow(queueKey)],
    flags: Ephemeral,
  }).catch(discordCatch('MUSIC', 'interaction'));
  return true;
}
if (parsed.action === 'stopno') {
  await interaction.update({ content: t('mgr.cancelled'), embeds: [], components: [] }).catch(discordCatch('MUSIC', 'interaction'));
  return true;
}
if (parsed.action === 'stopyes') {
  await interaction.update({ content: t('mgr.stopped'), embeds: [], components: [] }).catch(discordCatch('MUSIC', 'interaction'));
  await MusicManager.stopPlayback(queue, queueKey, guild);
  return true;
}
if (parsed.action === 'stop') {
  await interaction.deferReply({ flags: Ephemeral });
  await MusicManager.stopPlayback(queue, queueKey, guild);
  await interaction.editReply({ content: t('mgr.stopped') });
  return true;
}

if (guild) await MusicManager.refreshListeners(queue, guild);

try {
  switch (parsed.action) {
    case 'menu': {
      await interaction.deferReply({ flags: Ephemeral });
      MusicManager.syncHistory(queue, queueKey);
      const saved = MusicManager.getSavedPlaylists(queueKey);
      await interaction.editReply(buildMenuPayload(queue, queueKey, saved));
      break;
    }

    case 'playlists':
      await MusicManager.replyPlaylistManager(interaction, queueKey);
      break;

    case 'loadpl': {
      await interaction.deferUpdate();
      const key = interaction.values[0];
      const entry = playlistStore.getEntry(queueKey, key);
      if (!entry?.tracks?.length) {
        await interaction.followUp({ content: t('mgr.plNotFound'), flags: Ephemeral });
        break;
      }
      const { added, skipped } = MusicManager.enqueueTracks(queue, entry.tracks, interaction.user, queueKey);
      const embed = buildLoadSuccessEmbed(queueKey, entry, added, skipped);
      await interaction.followUp({ embeds: [embed], flags: Ephemeral });
      if (added.length && queue.player?.state?.status === AudioPlayerStatus.Idle) {
        queue.forceNewNowPlaying = true;
        await MusicManager.afterEnqueueThenNowPlaying(queueKey, guild, { skipNowPlaying: true });
      } else {
        await MusicManager.afterEnqueueThenNowPlaying(queueKey, guild);
      }
      break;
    }

    case 'urlpick': {
      const mode = parsed.arg;
      const pending = queue.pendingUrlChoice;
      if (!pending || pending.requesterId !== interaction.user.id) {
        await interaction.reply({
          content: t('mgr.linkExpired'),
          flags: Ephemeral,
        });
        break;
      }
      await interaction.deferUpdate();

      if (mode === 'video') {
        queue.pendingUrlChoice = null;
        const url = `https://www.youtube.com/watch?v=${pending.videoId}`;
        const track = await resolveTrackMetadata({
          title: '', url, thumbnail: '', durationSec: 0,
        });
        const addRes = MusicManager.enqueueTracks(queue, [track], interaction.user, queueKey);
        const { added } = addRes;
        MusicManager.ensurePlayerEvents(queueKey);
        if (!added.length) {
          await interaction.message.edit({
            content: MusicManager.notAddedText(addRes, track.title, queue.guild),
            embeds: [],
            components: [],
          });
          break;
        }
        if (queue.player?.state?.status === AudioPlayerStatus.Idle) {
          queue.forceNewNowPlaying = true;
          await MusicManager.schedulePlayNext(queueKey);
        } else {
          await interaction.message.edit({
            content: addedQueueText(queue, track.title),
            embeds: [],
            components: [],
          });
        }
        break;
      }

      if (mode === 'playlist') {
        try {
          const pendingPrefetch = queue.pendingUrlChoice?.prefetch;
          const list = pendingPrefetch
            ? await pendingPrefetch
            : await yts.fetchYouTubePlaylist(pending.listId, pending.videoId || null);
          if (!list?.videos?.length) throw new Error('playlist error: unviewable');
          const tracks = list.videos.map(v => MusicManager.videoToTrack(v, interaction.user));
          const { added, skipped, overCap } = MusicManager.enqueueTracks(queue, tracks, interaction.user, queueKey);
          MusicManager.ensurePlayerEvents(queueKey);
          queue.pendingUrlChoice = null;
          if (!added.length) {
            await interaction.message.edit({
              content: overCap ? t('mgr.queueFull', { max: MusicManager.MAX_QUEUE }) : t('mgr.allPlDup', { title: list.title }),
              embeds: [],
              components: [],
            });
            break;
          }
          if (queue.player?.state?.status === AudioPlayerStatus.Idle) {
            queue.forceNewNowPlaying = true;
            await MusicManager.schedulePlayNext(queueKey);
          } else {
            const extra = MusicManager.enqueueSuffix(skipped, overCap);
            await interaction.message.edit({
              content: t('mgr.addedPl', { count: added.length, title: list.title, extra }),
              embeds: [],
              components: [],
            });
          }
        } catch (err) {
          logMusicError(err, 'playlist', { queueKey });
          const mix = isYouTubeMixList(pending.listId);
          const hasVideo = Boolean(pending.videoId);
          await interaction.message.edit({
            content: mix ? formatMixPlaylistError(hasVideo) : formatMusicError(err, 'playlist'),
            embeds: [],
            components: hasVideo ? [buildVideoOnlyRow(queueKey)] : [],
          });
        }
      }
      break;
    }

    case 'loadhist': {
      await interaction.deferUpdate();
      MusicManager.syncHistory(queue, queueKey);
      const index = parseInt(interaction.values[0], 10);
      const track = queue.history?.[index];
      if (!track?.url) {
        await interaction.followUp({ content: t('mgr.histNotFound'), flags: Ephemeral });
        break;
      }
      const copy = {
        title: track.title,
        url: track.url,
        thumbnail: track.thumbnail || '',
        durationSec: track.durationSec || 0,
      };
      const addRes = MusicManager.enqueueTracks(queue, [copy], interaction.user, queueKey);
      const { added } = addRes;
      const theme = themeFor(queueKey);
      const embed = new EmbedBuilder()
        .setColor(theme.color)
        .setTitle(t('mgr.replayHist'))
        .setDescription(
          added.length
            ? addedQueueText(queue, copy.title)
            : MusicManager.notAddedText(addRes, copy.title, queue.guild),
        );
      await interaction.followUp({ embeds: [embed], flags: Ephemeral });
      queue.forceNewNowPlaying = true;
      await MusicManager.afterEnqueueThenNowPlaying(queueKey, guild, { skipNowPlaying: true });
      break;
    }

    case 'editpl': {
      const key = interaction.values[0];
      const entry = playlistStore.getEntry(queueKey, key);
      if (!entry?.tracks?.length) {
        await interaction.reply({ content: t('mgr.plNotFound'), flags: Ephemeral });
        break;
      }
      await interaction.update(buildPlaylistEditPayload(queueKey, key, entry, 0));
      break;
    }

    case 'editpage': {
      const [plKey, pageStr] = parsed.arg.split('|');
      const page = parseInt(pageStr, 10);
      const entry = playlistStore.getEntry(queueKey, plKey);
      if (!entry?.tracks?.length) {
        await interaction.update({
          content: t('mgr.plNotFound'),
          embeds: [],
          components: [],
        });
        break;
      }
      await interaction.update(buildPlaylistEditPayload(queueKey, plKey, entry, page));
      break;
    }

    case 'delpl': {
      const key = interaction.values[0];
      const entry = playlistStore.getEntry(queueKey, key);
      if (!entry) {
        await interaction.reply({ content: t('mgr.plNotFound'), flags: Ephemeral });
        break;
      }
      const embed = buildPlaylistDetailEmbed(queueKey, entry)
        .setTitle(t('mgr.deletePl', { name: entry.displayName }))
        .setDescription(t('music.desc.tracks', { count: entry.tracks.length }));
      await interaction.update({
        embeds: [embed],
        components: [buildDeleteConfirmRow(queueKey, key)],
      });
      break;
    }

    case 'del_yes': {
      const key = parsed.arg;
      const entry = playlistStore.getEntry(queueKey, key);
      playlistStore.remove(queueKey, key);
      await interaction.update({
        content: entry
          ? t('mgr.deletedPl', { name: entry.displayName })
          : t('mgr.deletedPl', { name: 'Playlist' }),
        embeds: [],
        components: [],
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'del_no':
      await MusicManager.replyPlaylistManager(interaction, queueKey, true);
      break;

    case 'rmtrack': {
      const [plKey, indexStr] = interaction.values[0].split('|');
      const index = parseInt(indexStr, 10);
      const result = playlistStore.removeTrack(queueKey, plKey, index);
      if (!result) {
        await interaction.reply({ content: t('mgr.cantRemove'), flags: Ephemeral });
        break;
      }
      if (result.playlistDeleted) {
        await interaction.update({
          content: t('mgr.removedEmpty', { title: result.removed.title }),
          embeds: [],
          components: [],
        });
      } else {
        const entry = playlistStore.getEntry(queueKey, plKey);
        let page = pageForTrackIndex(index);
        const pages = Math.max(1, Math.ceil(entry.tracks.length / TRACK_REMOVE_PAGE_SIZE));
        if (page >= pages) page = pages - 1;
        const payload = buildPlaylistEditPayload(queueKey, plKey, entry, page);
        payload.embeds[0].setFooter({
          text: `${result.removed.title} · ${t('music.desc.tracks', { count: result.remaining })}`,
        });
        await interaction.update(payload);
      }
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'clearask': {
      const items = MusicManager.getSavedPlaylists(queueKey);
      await interaction.reply({
        content: t('mgr.clearAllAsk', { count: items.length }),
        components: [buildClearConfirmRow(queueKey)],
        flags: Ephemeral,
      });
      break;
    }

    case 'clearyes': {
      const count = MusicManager.getSavedPlaylists(queueKey).length;
      playlistStore.clearAll(queueKey);
      await interaction.update({
        content: t('mgr.clearedPl', { count }),
        embeds: [],
        components: [],
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'clearno':
      await interaction.update({ content: t('mgr.cancelled'), embeds: [], components: [] });
      break;

    case 'pause': {
      if (queue.player.state.status === AudioPlayerStatus.Playing) {
        queue.player.pause();
        if (queue.current) queue.current.pausedAt = Date.now();
        await interaction.reply({ content: t('mgr.paused'), flags: Ephemeral });
      } else {
        if (queue.current?.pausedAt) {
          queue.current.startedAt += Date.now() - queue.current.pausedAt;
          queue.current.pausedAt = null;
        }
        queue.player.unpause();
        await interaction.reply({ content: t('mgr.resumed'), flags: Ephemeral });
      }
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'seekback':
    case 'seekfwd': {
      if (!queue.current) {
        await interaction.reply({ content: t('mgr.nothingPlay'), flags: Ephemeral });
        break;
      }
      await interaction.deferReply({ flags: Ephemeral });
      const delta = parsed.action === 'seekback' ? -10 : 10;
      const pos = await MusicManager.seekCurrent(queueKey, delta);
      if (pos === null || !queue.current) {
        await interaction.editReply({
          content: t('mgr.seekFail'),
        });
        break;
      }
      const total = queue.current.durationSec || 0;
      await interaction.editReply({
        content: t('mgr.seekPos', { pos: formatDuration(pos), total: formatDuration(total) }),
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'skip':
      if (gate.level === 'dj' || gate.level === 'admin') {
        MusicManager.skipCurrent(queue, queueKey);
        await interaction.reply({ content: t('mgr.skipped'), flags: Ephemeral });
        break;
      }
      await MusicManager.tryVoteSkip(interaction, queue, queueKey);
      break;

    case 'shuffle':
      shuffleArray(queue.tracks);
      await interaction.reply({ content: t('mgr.shuffled'), flags: Ephemeral });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;

    case 'loop': {
      MusicManager.cycleLoop(queue);
      await interaction.reply({
        content: t('mgr.loop', { mode: loopModeLabel(queue.loop) }),
        flags: Ephemeral,
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'volume': {
      const cap = guild ? require('../web/memberAccess').volumeCap(gate.level, require('../web/guildPerms').get(guild.id)) : 200;
      const vol = MusicManager.setMusicVolume(queue, Math.min(Number(interaction.values[0]) || 0, cap));
      await interaction.deferUpdate();
      await MusicManager.updateNowPlaying(queueKey, guild);
      await interaction.followUp({
        content: t('mgr.volume', { vol }),
        flags: Ephemeral,
      }).catch(discordCatch('MUSIC', 'interaction'));
      break;
    }

    case 'filter': {
      const key = interaction.values[0];
      await interaction.deferReply({ flags: Ephemeral });
      MusicManager.setFilter(queue, key);
      const label = filterLabel(key) || key;
      if (queue.current) {
        await MusicManager.restartCurrentWithFilter(queueKey);
        await interaction.editReply({
          content: t('mgr.filterNow', { label }),
        });
      } else {
        await interaction.editReply({
          content: t('mgr.filterNext', { label }),
        });
      }
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'pick': {
      const idx = Number(interaction.values[0]);
      const pending = queue.pendingSearch;
      if (!pending?.videos?.[idx]) {
        await interaction.reply({ content: t('mgr.searchExpired'), flags: Ephemeral });
        return true;
      }
      const v = pending.videos[idx];
      const track = MusicManager.videoToTrack(v, pending.requester);
      const addRes = MusicManager.enqueueTracks(queue, [track], pending.requester, queueKey);
      const { added } = addRes;
      queue.pendingSearch = null;
      MusicManager.ensurePlayerEvents(queueKey);
      if (!added.length) {
        await interaction.update({
          content: MusicManager.notAddedText(addRes, track.title, queue.guild),
          embeds: [],
          components: [],
        });
        break;
      }
      if (queue.player?.state?.status === AudioPlayerStatus.Idle) {
        queue.forceNewNowPlaying = true;
        await interaction.deferUpdate();
        await MusicManager.schedulePlayNext(queueKey);
      } else {
        MusicManager.resumeIfPaused(queue);
        await interaction.update({
          content: addedQueueText(queue, track.title),
          embeds: [],
          components: [],
        });
      }
      break;
    }

    case 'lyrics':
      await MusicManager.cmdLyrics(interaction, queue, { isInteraction: true });
      break;

    case 'history': {
      await interaction.deferReply({ flags: Ephemeral });
      MusicManager.syncHistory(queue, queueKey);
      await interaction.editReply(buildHistoryPayload(queue, queueKey));
      break;
    }

    case 'clearhistask': {
      MusicManager.syncHistory(queue, queueKey);
      if (!queue.history?.length) {
        await interaction.reply({ content: t('mgr.histEmpty'), flags: Ephemeral });
        break;
      }
      await interaction.reply({
        content: t('mgr.clearHistAsk', { count: queue.history.length }),
        components: [buildClearHistoryConfirmRow(queueKey)],
        flags: Ephemeral,
      });
      break;
    }

    case 'clearhistyes': {
      historyStore.clear(queueKey);
      queue.history = [];
      await interaction.update({
        content: t('mgr.histCleared'),
        embeds: [],
        components: [],
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'clearhistno':
      await interaction.update({ content: t('mgr.cancelled'), embeds: [], components: [] });
      break;

    case 'stats': {
      await interaction.reply({
        embeds: [buildStatsEmbed(queue, queueKey)],
        flags: Ephemeral,
      });
      break;
    }

    case 'restart': {
      if (!queue.current) {
        await interaction.reply({ content: t('mgr.nothingPlay'), flags: Ephemeral });
        break;
      }
      await interaction.deferUpdate();
      await MusicManager.replayCurrentTrack(queueKey, { startSec: 0 });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'replaylast': {
      const videoId = parsed.arg;
      if (!videoId || videoId === 'x') {
        await interaction.reply({ content: t('mgr.nothingPlay'), flags: Ephemeral });
        break;
      }
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      let raw = null;
      if (queue.lastFinishedTrack && extractVideoId(queue.lastFinishedTrack.url) === videoId) {
        raw = queue.lastFinishedTrack;
      }
      if (!raw) {
        MusicManager.syncHistory(queue, queueKey);
        raw = queue.history?.find(h => extractVideoId(h.url) === videoId);
      }
      await interaction.deferUpdate();
      let track;
      if (raw?.url) {
        track = {
          title: raw.title,
          url: raw.url,
          thumbnail: raw.thumbnail || '',
          durationSec: raw.durationSec || 0,
          requester: raw.requester || interaction.user,
        };
      } else {
        const meta = await resolveTrackMetadata({ title: '', url, thumbnail: '', durationSec: 0 });
        track = {
          title: meta.title,
          url: meta.url || url,
          thumbnail: meta.thumbnail || '',
          durationSec: meta.durationSec || 0,
          requester: interaction.user,
        };
      }
      const addRes = MusicManager.enqueueTracks(queue, [track], interaction.user, queueKey);
      const { added } = addRes;
      if (!added.length) {
        await interaction.followUp({
          content: MusicManager.notAddedText(addRes, track.title, queue.guild),
          flags: Ephemeral,
        });
        break;
      }
      queue.forceNewNowPlaying = true;
      await MusicManager.afterEnqueueThenNowPlaying(queueKey, guild, { skipNowPlaying: true });
      await interaction.followUp({
        content: addedQueueText(queue, track.title),
      }).catch(discordCatch('MUSIC', 'replaylast'));
      break;
    }

    case 'transfer': {
      if (interaction.user.id !== queue.roomOwnerId) {
        await interaction.reply({
          content: t('mgr.transferOnly'),
          flags: Ephemeral,
        });
        break;
      }
      const candidates = MusicManager.getTransferCandidates(queue, guild);
      if (!candidates.length) {
        await interaction.reply({
          content: t('mgr.noTransfer'),
          flags: Ephemeral,
        });
        break;
      }
      const row = buildTransferSelectRow(queueKey, candidates, guild);
      await interaction.reply({
        content: t('mgr.chooseOwner'),
        components: row ? [row] : [],
        flags: Ephemeral,
      });
      break;
    }

    case 'transferpick': {
      if (interaction.user.id !== queue.roomOwnerId) {
        await interaction.reply({
          content: t('mgr.transferOnly'),
          flags: Ephemeral,
        });
        break;
      }
      const newOwnerId = interaction.values[0];
      const ok = await MusicManager.transferRoomOwner(queue, newOwnerId, guild);
      if (!ok) {
        await interaction.update({
          content: t('mgr.transferFail'),
          components: [],
        });
        break;
      }
      await interaction.update({
        content: t('mgr.transferOk', { id: newOwnerId }),
        components: [],
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'queue': {
      await interaction.deferReply({ flags: Ephemeral });
      await interaction.editReply(buildQueuePayload(queue, queueKey));
      break;
    }

    case 'qpage': {
      await interaction.deferUpdate();
      await interaction.editReply(buildQueuePayload(queue, queueKey, parsed.arg));
      break;
    }

    case 'playqueue': {
      const index = parseInt(interaction.values[0], 10);
      const result = MusicManager.jumpToQueueTrack(queue, queueKey, index);
      if (!result) {
        await interaction.reply({ content: t('mgr.notInQueue'), flags: Ephemeral });
        break;
      }
      const { track, needsStart } = result;
      if (needsStart) {
        MusicManager.ensurePlayerEvents(queueKey);
        await MusicManager.schedulePlayNext(queueKey);
      }
      await interaction.reply({
        content: t('mgr.nowPlaying', { title: track.title }),
        flags: Ephemeral,
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'movepick': {
      queue.pendingMoveIndex = parseInt(interaction.values[0], 10);
      await interaction.deferUpdate();
      await interaction.followUp({
        content: t('mgr.moveSelected', { pos: queue.pendingMoveIndex }),
        flags: Ephemeral,
      });
      break;
    }

    case 'moveup':
    case 'movedown': {
      await interaction.deferUpdate();
      const idx = queue.pendingMoveIndex;
      if (!idx) {
        await interaction.followUp({
          content: t('mgr.selectFirst'),
          flags: Ephemeral,
        });
        break;
      }
      const dir = parsed.action === 'moveup' ? 'up' : 'down';
      const newPos = MusicManager.moveQueueTrack(queue, idx, dir);
      if (!newPos) {
        await interaction.followUp({
          content: dir === 'up' ? t('mgr.atTop') : t('mgr.atBottom'),
          flags: Ephemeral,
        });
        break;
      }
      queue.pendingMoveIndex = newPos;
      await interaction.editReply(buildQueuePayload(queue, queueKey, queuePageFor(newPos)));
      await interaction.followUp({
        content: t('mgr.moved', { pos: newPos }),
        flags: Ephemeral,
      });
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'startautodj': {
      const { content, scheduleUpdate } = MusicManager.prepareAutoDjStart(
        queue, queueKey, getVoice,
      );
      await interaction.reply({ content, flags: Ephemeral });
      if (scheduleUpdate) {
        setTimeout(() => MusicManager.updateNowPlaying(queueKey, guild).catch(discordCatch('MUSIC', 'interaction')), 2500);
      }
      break;
    }

    case 'autodj': {
      const payload = buildAutoDjPayload(queue, queueKey);
      if (isMusicMenuMessage(interaction)) {
        await interaction.update(payload);
      } else {
        await interaction.reply({ ...payload, flags: Ephemeral });
      }
      break;
    }

    case 'autodjtoggle': {
      queue.autoDj.enabled = !queue.autoDj.enabled;
      const payload = buildAutoDjPayload(queue, queueKey);
      const moodLabel = moodLabelFromId(queue.autoDj.query);
      payload.embeds[0].setFooter({
        text: queue.autoDj.enabled ? t('mgr.autoDjOn', { query: moodLabel }) : t('mgr.autoDjOff'),
      });
      await interaction.update(payload);
      if (queue.autoDj.enabled) {
        if (!MusicManager.maybeStartAutoDj(queueKey) && !MusicManager.hasActivePlayback(queue, queue.player)) {
          MusicManager.ensurePlayerEvents(queueKey);
          MusicManager.armMusicPlayback(queue);
          void MusicManager.schedulePlayNext(queueKey);
        }
      }
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'autodjmood': {
      const mood = interaction.values[0];
      const isSimilar = mood === '__similar__';
      if (isSimilar) {
        queue.autoDj.mode = 'similar';
      } else {
        queue.autoDj.query = mood;
        queue.autoDj.mode = 'mood';
      }
      queue.autoDj.enabled = true;
      const moodLabel = isSimilar ? t('music.mood.similar') : moodLabelFromId(mood);
      const payload = buildAutoDjPayload(queue, queueKey);
      payload.embeds[0].setFooter({
        text: t('mgr.autoDjOn', { query: moodLabel }),
      });
      if (isMusicMenuMessage(interaction)) {
        await interaction.update(payload);
      } else {
        await interaction.reply({
          content: t('mgr.autoDjOn', { query: moodLabel }),
          flags: Ephemeral,
        });
      }
      if (!MusicManager.hasActivePlayback(queue, queue.player)) {
        queue.tracks = [];
        MusicManager.ensurePlayerEvents(queueKey);
        MusicManager.armMusicPlayback(queue);
        void MusicManager.schedulePlayNext(queueKey);
      } else if (!MusicManager.maybeStartAutoDj(queueKey)) {
        // Already playing — new mood applies on next Auto-DJ fill.
      }
      setTimeout(() => MusicManager.updateNowPlaying(queueKey, guild).catch(discordCatch('MUSIC', 'interaction')), 2500);
      break;
    }

    case 'npui': {
      if (!queue.roomOwnerId) {
        await interaction.reply({ content: t('cmd.voteSkipNoOwner'), flags: Ephemeral });
        break;
      }
      if (interaction.user.id !== queue.roomOwnerId) {
        await interaction.reply({ content: t('mgr.npUiOwnerOnly'), flags: Ephemeral });
        break;
      }
      const gid = guild?.id || parseSlaveQueueKey(queueKey)?.guildId;
      const newSize = cycleNpUiSize(queueKey, gid);
      await MusicManager.updateNowPlaying(queueKey, guild);
      const saved = MusicManager.getSavedPlaylists(queueKey);
      const menuPayload = buildMenuPayload(queue, queueKey, saved);
      menuPayload.embeds[0].setFooter({
        text: t('mgr.npUiChanged', { size: npUiSizeLabel(newSize) }),
      });
      if (isMusicMenuMessage(interaction)) {
        await interaction.update(menuPayload);
      } else {
        await interaction.reply({
          content: t('mgr.npUiChanged', { size: npUiSizeLabel(newSize) }),
          flags: Ephemeral,
        });
      }
      break;
    }

    case 'menucontrols': {
      await interaction.update(buildControlsSubPagePayload(queue, queueKey));
      break;
    }

    case 'menuback': {
      const saved = MusicManager.getSavedPlaylists(queueKey);
      await interaction.update(buildMenuPayload(queue, queueKey, saved));
      break;
    }

    case 'skipmodetoggle': {
      const { setSlaveVoteToSkip, getEffectiveVoteToSkip } = require('../panel/musicSkipSettings');
      const slave = parseSlaveQueueKey(queueKey);
      if (!slave) break;
      if (guild) MusicManager.syncRoomRoster(queue, guild);
      if (!queue.roomOwnerId) {
        await interaction.reply({ content: t('cmd.voteSkipNoOwner'), flags: Ephemeral });
        break;
      }
      if (interaction.user.id !== queue.roomOwnerId) {
        await interaction.reply({ content: t('cmd.voteSkipOwnerOnly'), flags: Ephemeral });
        break;
      }
      const gid = guild?.id || slave.guildId;
      const next = !getEffectiveVoteToSkip(slave.name, gid);
      setSlaveVoteToSkip(slave.name, gid, next);
      const saved = MusicManager.getSavedPlaylists(queueKey);
      const menuPayload = buildMenuPayload(queue, queueKey, saved);
      menuPayload.embeds[0].setFooter({
        text: next ? t('mgr.skipModeVote') : t('mgr.skipModeInstant'),
      });
      await interaction.update(menuPayload);
      break;
    }

    case 'skipmode': {
      const { setSlaveVoteToSkip, getEffectiveVoteToSkip } = require('../panel/musicSkipSettings');
      const slave = parseSlaveQueueKey(queueKey);
      if (!slave) break;
      if (guild) MusicManager.syncRoomRoster(queue, guild);
      if (!queue.roomOwnerId) {
        await interaction.reply({ content: t('cmd.voteSkipNoOwner'), flags: Ephemeral });
        break;
      }
      if (interaction.user.id !== queue.roomOwnerId) {
        await interaction.reply({ content: t('cmd.voteSkipOwnerOnly'), flags: Ephemeral });
        break;
      }
      const gid = guild?.id || slave.guildId;
      const enabled = interaction.values[0] === 'vote';
      if (enabled === getEffectiveVoteToSkip(slave.name, gid)) {
        await interaction.deferUpdate().catch(discordCatch('MUSIC', 'interaction'));
        break;
      }
      setSlaveVoteToSkip(slave.name, gid, enabled);
      const saved = MusicManager.getSavedPlaylists(queueKey);
      const menuPayload = buildMenuPayload(queue, queueKey, saved);
      menuPayload.embeds[0].setFooter({
        text: enabled ? t('mgr.skipModeVote') : t('mgr.skipModeInstant'),
      });
      await interaction.update(menuPayload);
      break;
    }

    case 'rmqueue': {
      const index = parseInt(interaction.values[0], 10);
      const removed = MusicManager.removeFromQueue(queue, index);
      if (!removed) {
        await interaction.reply({ content: t('mgr.cantRemove'), flags: Ephemeral });
        break;
      }
      const saved = MusicManager.getSavedPlaylists(queueKey);
      const menuPayload = buildMenuPayload(queue, queueKey, saved);
      menuPayload.embeds[0].setFooter({ text: removed.title });
      await interaction.update(menuPayload);
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;
    }

    case 'refresh':
      await interaction.deferUpdate();
      await MusicManager.updateNowPlaying(queueKey, guild);
      break;

    default:
      return false;
  }
    } catch (err) {
      if (isUnknownInteraction(err) || isInteractionAcknowledged(err)) return true;
      logMusicError(err, 'interaction', { queueKey });
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: formatMusicError(err, 'search'),
          flags: Ephemeral,
        }).catch(discordCatch('MUSIC', 'interaction'));
      } else if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: formatMusicError(err, 'search'),
          flags: Ephemeral,
        }).catch(discordCatch('MUSIC', 'interaction'));
      }
    }
    return true;
}

module.exports = { handleMusicInteraction };
