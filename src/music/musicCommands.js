// musicCommands.js – per-channel music (each SLAVE = its own room DJ) or global per-guild
const MusicManager = require('./MusicManager');
const { Ephemeral } = require('../util/interactionFlags');
const { safeListener } = require('../util/safeListener');
const { formatMusicError, logMusicError, isUnknownInteraction, isInteractionAcknowledged } = require('./musicErrors');
const { logDiscordFailure } = require('../util/logger');
const { parseMusicId, buildPlayModal, buildSaveModal } = require('./musicUI');
const {
  claimMusicMessage,
  claimMusicInteraction,
  claimMusicReply,
} = require('../util/messageDedup');
const localeStore = require('../i18n/localeStore');
const { runWithLocale, t } = require('../i18n/context');
const { discordGate } = require('../web/memberAccess');
const { isHelpCommand, isBarePlayCommand, extractPlayQuery, detectLangFromCommand, parseMusicCtlCommand } = require('../i18n');
const {
  checkMusicAccess,
  formatAccessDeny,
  isAssignedMusicTextChannel,
  resolveMusicQueueKey,
  pickDenyQueueKey,
  isSlaveMusicChatSilenced,
} = require('../subscription/guildRoomAccess');
const globalVoice = require('../bots/globalVoice');
const { queueKeyForGuild, musicQueueKeyMatches } = require('./queueKey');
const { getGuildMasterChannels } = require('../config/channels');
const { slaveQueueKey } = require('./slaveQueueKey');

const channelToQueues = new Map();
const expiredReplyAt = new Map();

function addChannelQueue(channelId, queueKey) {
  if (!channelId || !queueKey) return;
  if (!channelToQueues.has(channelId)) channelToQueues.set(channelId, new Set());
  channelToQueues.get(channelId).add(queueKey);
}

function removeChannelQueue(channelId, queueKey) {
  if (!channelId || !queueKey) return;
  const set = channelToQueues.get(channelId);
  if (!set) return;
  set.delete(queueKey);
  if (!set.size) channelToQueues.delete(channelId);
}

function mapMusicChannels(voiceChannelId, textChannelId, queueKey) {
  addChannelQueue(voiceChannelId, queueKey);
  addChannelQueue(textChannelId, queueKey);
}

function unmapMusicChannels(voiceChannelId, textChannelId, queueKey) {
  removeChannelQueue(voiceChannelId, queueKey);
  removeChannelQueue(textChannelId, queueKey);
}

function updateMusicRoom(client, voiceChannelId, textChannelId, queueKey = null) {
  const qk = queueKey || client?._musicQueueKey;
  if (!qk) return;

  if (!client._musicRooms) client._musicRooms = new Map();
  const prev = client._musicRooms.get(qk);
  if (prev) unmapMusicChannels(prev.voiceChannelId, prev.textChannelId, qk);

  const room = { voiceChannelId, textChannelId };
  client._musicRooms.set(qk, room);
  if (!client._musicQueueKey) client._musicQueueKey = qk;
  if (!client._musicRoom) client._musicRoom = room;
  mapMusicChannels(voiceChannelId, textChannelId, qk);
  const queue = MusicManager.getQueue(qk);
  if (queue) queue.voiceChannelId = voiceChannelId;
}

function getClientMusicQueueKeys(client, guildId) {
  const registry = require('../bridge/registry');
  const keys = [];
  for (const entry of registry.state.slaves.values()) {
    if (entry.client === client && String(entry.cfg?.guildId) === String(guildId)) {
      keys.push(slaveQueueKey(entry.cfg));
    }
  }
  return keys;
}

function resolveSlaveQueueKeyForClient(client, guildId, channelId) {
  const keys = getClientMusicQueueKeys(client, guildId);
  if (!keys.length) return null;
  if (channelId) {
    const match = keys.find(k => isAssignedMusicTextChannel(guildId, channelId, k));
    if (match) return match;
  }
  return keys[0];
}

/**
 * Shared-pool routing: only the bot deployment that owns queueKey may handle or deny.
 * Returns queueKey, null (silent — another bot owns it), or false (not a music text channel).
 */
function routeSharedPoolMessage(client, guildId, channelId, voiceChannelId) {
  const clientKeys = getClientMusicQueueKeys(client, guildId);
  if (!clientKeys.length) return false;

  const textMatches = clientKeys.filter(k => isAssignedMusicTextChannel(guildId, channelId, k));
  if (!textMatches.length) return false;

  const responsible = resolveMusicQueueKey(guildId, channelId, voiceChannelId);
  if (responsible) {
    return clientKeys.includes(responsible) ? responsible : null;
  }

  const denyKey = pickDenyQueueKey(guildId, channelId);
  return denyKey && clientKeys.includes(denyKey) ? denyKey : null;
}

function slaveVoiceBundleForQueue(queueKey) {
  const registry = require('../bridge/registry');
  const { slaveQueueKey } = require('./slaveQueueKey');
  for (const entry of registry.state.slaves.values()) {
    if (slaveQueueKey(entry.cfg) === queueKey) {
      return {
        player: entry.player ?? null,
        connection: entry.connection ?? null,
        voiceChannelId: entry.cfg?.channelId ?? null,
        textChannelId: entry.cfg?.textChannelId ?? null,
      };
    }
  }
  return { player: null, connection: null, voiceChannelId: null, textChannelId: null };
}

function warnDuplicateInstance(queueKey, err) {
  if (!isUnknownInteraction(err) && !isInteractionAcknowledged(err)) return;
  console.error(
    `[MUSIC:${queueKey}] Another process may be using this bot token (old botv2 / VPS).`
    + ' Regenerate MASTER_TOKEN in the Developer Portal if buttons keep failing.',
  );
}

function syncGlobalGuildRoom(guildId) {
  const ch = getGuildMasterChannels(guildId);
  if (!ch.voiceChannelId) return;
  mapMusicChannels(ch.voiceChannelId, ch.textChannelId, queueKeyForGuild(guildId));
}

async function denyMusicAccess(message, member, queueKey, { inAssignedText = true } = {}) {
  const access = await checkMusicAccess({
    guild: message.guild,
    member,
    userId: message.author.id,
    channelId: message.channelId,
    queueKey,
  });
  if (access.ok) return false;
  if (access.reason === 'expired') {
    // T63 (review U8): say why instead of silence, once per channel per hour.
    const key = `exp:${message.channelId}`;
    const now = Date.now();
    if ((expiredReplyAt.get(key) || 0) + 3_600_000 < now) {
      expiredReplyAt.set(key, now);
      const lang = localeStore.get(message.author.id);
      await runWithLocale(lang, () => message.reply(t('sub.expiredReply'))).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
    }
    return true;
  }
  if (access.reason === 'sub') return true;
  if (!inAssignedText && access.reason === 'text') return true;
  const lang = localeStore.get(message.author.id);
  await runWithLocale(lang, () => message.reply(formatAccessDeny(access.reason, message.guild, queueKey))).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
  return true;
}

async function denyMusicInteraction(interaction, queueKey) {
  const access = await checkMusicAccess({
    guild: interaction.guild,
    member: interaction.member,
    userId: interaction.user.id,
    channelId: interaction.channelId,
    queueKey,
  });
  if (access.ok) return false;
  const silent = access.reason === 'sub' || access.reason === 'expired';
  if (interaction.deferred && !interaction.replied) {
    // playmodal is deferred before the access check: never leave it on "thinking…".
    // The defer is public (search results are public): drop it and tell only this user why.
    await interaction.deleteReply().catch((err) => logDiscordFailure('MUSIC', err, 'command'));
    if (!silent) {
      await interaction.followUp({
        content: formatAccessDeny(access.reason, interaction.guild, queueKey),
        flags: Ephemeral,
      }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
    }
    return true;
  }
  if (silent) return true;
  if (interaction.isRepliable() && !interaction.replied) {
    await interaction.reply({
      content: formatAccessDeny(access.reason, interaction.guild, queueKey),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
  }
  return true;
}

async function resolveMemberVoice(member, client, queueKey) {
  try {
    return await globalVoice.ensureMemberVoice(member, client, queueKey);
  } catch (err) {
    if (err.code === 'NOT_IN_VOICE') return null;
    throw err;
  }
}

const VOICE_JOIN_ACTIONS = new Set([
  'playmodal', 'pick', 'urlpick', 'loadpl', 'loadhist', 'startautodj', 'playqueue',
]);

function voiceBundleFromRuntime(guildId, queueKey) {
  const queue = MusicManager.getQueue(queueKey);
  if (queue.player && queue.connection) {
    return {
      player: queue.player,
      connection: queue.connection,
      voiceChannelId: queue.voiceChannelId || globalVoice.getVoiceChannelId(guildId),
    };
  }
  const entry = globalVoice.getEntry(guildId);
  if (entry?.player && entry?.connection) {
    return {
      player: entry.player,
      connection: entry.connection,
      voiceChannelId: entry.voiceChannelId,
    };
  }
  return null;
}

function attachMusicCommands(client, opts = {}) {
  if (client._musicCommandsAttached) return;
  client._musicCommandsAttached = true;

  const sharedPool = Boolean(opts.sharedSlavePool);
  const slaveMode = Boolean(opts.queueKey || sharedPool);
  const bridgeOpts = slaveMode && !sharedPool ? opts : null;

  if (slaveMode && !sharedPool) {
    const {
      voiceChannelId,
      textChannelId = null,
      queueKey,
    } = bridgeOpts;

    client._musicQueueKey = queueKey;
    client._musicRoom = { voiceChannelId, textChannelId };
    mapMusicChannels(voiceChannelId, textChannelId, queueKey);
  }

  const roomForQueue = (queueKey) => {
    if (queueKey && client._musicRooms?.has(queueKey)) {
      return client._musicRooms.get(queueKey);
    }
    return client._musicRoom ?? { voiceChannelId: null, textChannelId: null };
  };

  const onMessage = async (message) => {
    if (message.author.bot || !client.user) return;
    if (!message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();

    const ctlCmd = parseMusicCtlCommand(content);
    const isMusicCmd = isHelpCommand(lower)
      || isBarePlayCommand(content)
      || extractPlayQuery(content) != null
      || ctlCmd != null;
    if (!isMusicCmd) return;

    let queueKey;
    let useGlobalReplyClaim = false;
    let member = message.member
      ?? await message.guild.members.fetch(message.author.id).catch(() => null);

    if (!slaveMode) {
      queueKey = queueKeyForGuild(message.guild.id);
    } else if (sharedPool) {
      const routed = routeSharedPoolMessage(
        client,
        message.guild.id,
        message.channelId,
        member?.voice?.channelId ?? null,
      );
      if (routed === false || routed === null) return;
      queueKey = routed;
      useGlobalReplyClaim = true;
    } else {
      queueKey = bridgeOpts.queueKey;
    }

    if (slaveMode && !queueKey) return;

    const inAssignedText = isAssignedMusicTextChannel(message.guild.id, message.channelId, queueKey);

    if (!inAssignedText) {
      if (slaveMode) return;
      return;
    }

    if (slaveMode && isSlaveMusicChatSilenced(message.guild.id, queueKey)) return;

    if (useGlobalReplyClaim) {
      if (!claimMusicReply(message.id)) return;
    } else if (!claimMusicMessage(client.user.id, message.id)) {
      return;
    }

    if (await denyMusicAccess(message, member, queueKey, { inAssignedText: true })) return;

    syncGlobalGuildRoom(message.guild.id);

    const detected = detectLangFromCommand(content);
    if (detected) localeStore.set(message.author.id, detected);
    const lang = localeStore.get(message.author.id);

    const syncQueueContext = () => {
      const queue = MusicManager.getQueue(queueKey);
      if (message.channel) queue.textChannel = message.channel;
      if (message.guild) queue.guild = message.guild;
      return queue;
    };

    // Member levels (same as dashboard + buttons). Returns the gate, or null after replying with the reason.
    const gateText = async (action) => {
      const g = discordGate(member, message.guild, MusicManager.getQueue(queueKey), action);
      if (g.ok) { try { require('../web/audit').recordDiscord(member, queueKey, action); } catch { /* best-effort */ } return g; }
      await runWithLocale(lang, () => message.reply(t(g.reason))).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
      return null;
    };

    const getVoiceBundle = () => {
      if (!slaveMode) {
        return voiceBundleFromRuntime(message.guild.id, queueKey);
      }
      if (sharedPool) {
        return slaveVoiceBundleForQueue(queueKey);
      }
      return {
        ...bridgeOpts.getVoice(),
        voiceChannelId: roomForQueue(bridgeOpts.queueKey).voiceChannelId,
      };
    };

    const applyVoiceBundle = (queue, bundle) => {
      if (bundle?.player && bundle?.connection) {
        MusicManager.syncVoiceFromClient(queueKey, () => ({
          player: bundle.player,
          connection: bundle.connection,
        }));
      }
      return bundle;
    };

    const handleCtlCommand = async (cmd) => {
      const gate = await gateText(cmd.action);
      if (!gate) return null;
      const queue = syncQueueContext();
      applyVoiceBundle(queue, getVoiceBundle());

      const needsPlayback = ['skip', 'stop', 'loop', 'lyrics', 'pause', 'resume', 'np', 'seek', 'back'].includes(cmd.action);
      if (needsPlayback && MusicManager.isNothingPlaying(queue)) {
        return message.reply(t('mgr.nothingPlay'));
      }

      switch (cmd.action) {
        case 'skip':
          if (gate.level === 'dj' || gate.level === 'admin') {
            MusicManager.skipCurrent(queue, queueKey);
            return message.reply(t('mgr.skipped'));
          }
          return MusicManager.voteSkipMessage(message, queue, queueKey);
        case 'stop': {
          const { STOP_CONFIRM_OVER, buildStopConfirmRow } = require('./musicUI');
          if ((queue.tracks?.length || 0) > STOP_CONFIRM_OVER) {
            return message.reply({ content: t('mgr.stopAsk', { count: queue.tracks.length }), components: [buildStopConfirmRow(queueKey)] });
          }
          await MusicManager.stopPlayback(queue, queueKey, message.guild);
          return message.reply(t('mgr.stopped'));
        }
        case 'loop': {
          MusicManager.cycleLoop(queue);
          await MusicManager.updateNowPlaying(queueKey, message.guild);
          return message.reply(t('mgr.loop', { mode: MusicManager.loopModeLabel(queue.loop) }));
        }
        case 'vol':
          return MusicManager.cmdVolumeText(message, queue, queueKey, message.guild, cmd.arg,
            require('../web/memberAccess').volumeCap(gate.level, require('../web/guildPerms').get(message.guild.id)));
        case 'history':
          return MusicManager.showHistory(message, queueKey);
        case 'lyrics':
          return MusicManager.cmdLyrics(message, queue, { isInteraction: false });
        case 'pause':
        case 'resume':
        case 'np':
        case 'queue':
        case 'shuffle':
        case 'remove':
        case 'clear':
        case 'seek':
        case 'back':
          return MusicManager.cmdTextControl(message, queue, queueKey, message.guild, cmd);
        default:
          return null;
      }
    };

    if (isHelpCommand(lower)) {
      return runWithLocale(lang, () => MusicManager.showHelp(message, queueKey));
    }

    if (ctlCmd && ctlCmd.action !== 'auto') {
      return runWithLocale(lang, () => handleCtlCommand(ctlCmd));
    }

    let player;
    let connection;
    let voiceChannelId;

    if (!slaveMode) {
      const voice = await resolveMemberVoice(member, client, queueKey);
      if (!voice) {
        return runWithLocale(lang, () => message.reply(t('music.notInVoice'))).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
      }
      ({ player, connection, voiceChannelId } = voice);
    } else {
      const bundle = getVoiceBundle();
      ({ player, connection, voiceChannelId } = bundle);
    }

    if (ctlCmd?.action === 'auto') {
      if (!(await gateText('autodj'))) return;
      return runWithLocale(lang, async () => {
        const queue = syncQueueContext();
        if (!player || !connection) {
          return message.reply(t('music.voiceNotReady'));
        }
        MusicManager.syncVoiceFromClient(queueKey, () => ({ player, connection }));
        return MusicManager.startAutoDjText(
          message, queue, queueKey, message.guild, ctlCmd.arg,
          () => ({ player, connection }),
        );
      });
    }

    const query = extractPlayQuery(content);
    if (!isBarePlayCommand(content) && query == null) return;
    if (!(await gateText('play'))) return;

    return runWithLocale(lang, async () => {
      if (isBarePlayCommand(content)) {
        if (!player || !connection) {
          return message.reply(t('music.voiceNotReady'));
        }
        return MusicManager.cmdPlayDefault(message, queueKey, player, bridgeOpts?.defaultPlaylist);
      }

      if (!player || !connection) {
        return message.reply(t('music.connectionNotReady'));
      }

      try {
        if (!query) return;
        await MusicManager.handlePlay(message, query, player, connection, queueKey, voiceChannelId);
      } catch (err) {
        logMusicError(err, 'command');
        await message.reply(formatMusicError(err, 'search')).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
      }
    });
  };

  const onInteraction = async (interaction) => {
    const customId = interaction.customId;
    if (!customId?.startsWith('music:')) return;
    if (!interaction.guild) return;

    const queueKey = !slaveMode
      ? queueKeyForGuild(interaction.guild.id)
      : (sharedPool
        ? resolveSlaveQueueKeyForClient(client, interaction.guild.id, interaction.channelId)
        : bridgeOpts.queueKey);
    if (slaveMode && !queueKey) return;

    if (!slaveMode && !isAssignedMusicTextChannel(interaction.guild.id, interaction.channelId, queueKey)) {
      return;
    }
    if (slaveMode) {
      if (isSlaveMusicChatSilenced(interaction.guild.id, queueKey)) return;
      if (!isAssignedMusicTextChannel(interaction.guild.id, interaction.channelId, queueKey)) return;
    }

    const parsed = parseMusicId(customId);
    if (!parsed || !musicQueueKeyMatches(parsed.queueKey, queueKey, interaction.guild.id)) return;

    const msgAuthorId = interaction.message?.author?.id;
    if (!msgAuthorId || msgAuthorId !== client.user.id) return;
    if (!claimMusicInteraction(client.user?.id, interaction.id)) return;

    if (interaction.isButton()) {
      if (parsed.action === 'playsearch' || parsed.action === 'savepl') {
        const age = Date.now() - interaction.createdTimestamp;
        console.log(`[MUSIC:${queueKey}] playsearch click age=${age}ms id=${interaction.id}`);
        try {
          const modal = parsed.action === 'playsearch'
            ? buildPlayModal(queueKey)
            : buildSaveModal(queueKey);
          await interaction.showModal(modal);
        } catch (err) {
          warnDuplicateInstance(queueKey, err);
          if (!isUnknownInteraction(err) && !isInteractionAcknowledged(err)) {
            logMusicError(err, 'interaction', { queueKey, action: parsed.action });
          }
          console.error(
            `[MUSIC:${queueKey}] showModal ${parsed.action} failed: ${err.message}`
            + ` replied=${interaction.replied} deferred=${interaction.deferred}`,
          );
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: t('music.modalFailed'),
              flags: Ephemeral,
            }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
          }
        }
        return;
      }
    }

    if (interaction.isModalSubmit() && parsed.action === 'playmodal'
      && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply().catch((err) => logDiscordFailure('MUSIC', err, 'command'));
    }

    if (await denyMusicInteraction(interaction, queueKey)) return;

    syncGlobalGuildRoom(interaction.guild.id);

    const lang = localeStore.resolveFromInteraction(interaction);
    return runWithLocale(lang, async () => {
    try {
      let voiceChannelId = !slaveMode
        ? globalVoice.getVoiceChannelId(interaction.guild.id)
        : roomForQueue(queueKey).voiceChannelId;

      let voiceBundle = !slaveMode
        ? voiceBundleFromRuntime(interaction.guild.id, queueKey)
        : null;

      const needsVoiceJoin = !slaveMode && (
        interaction.isModalSubmit()
        || VOICE_JOIN_ACTIONS.has(parsed.action)
      );

      if (!slaveMode && needsVoiceJoin && !voiceBundle) {
        const member = interaction.member
          ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        voiceBundle = await resolveMemberVoice(member, client, queueKey);
        if (!voiceBundle) {
          if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: t('music.notInVoice'), flags: Ephemeral }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
          } else if (interaction.deferred) {
            await interaction.editReply({ content: t('music.notInVoice') }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
          }
          return;
        }
      }

      if (!slaveMode && voiceBundle) {
        voiceChannelId = voiceBundle.voiceChannelId;
      }

      const getVoiceFn = () => {
        if (!slaveMode) {
          const bundle = voiceBundle ?? voiceBundleFromRuntime(interaction.guild.id, queueKey);
          if (bundle?.player && bundle?.connection) {
            return { player: bundle.player, connection: bundle.connection };
          }
        }
        if (sharedPool) {
          const bundle = slaveVoiceBundleForQueue(queueKey);
          return { player: bundle.player, connection: bundle.connection };
        }
        return bridgeOpts?.getVoice?.() ?? { player: null, connection: null };
      };

      if (interaction.isModalSubmit() && parsed.action === 'savemodal') {
        return await MusicManager.cmdSaveModal(interaction, queueKey);
      }

      if (interaction.isModalSubmit() && parsed.action === 'playmodal') {
        const { player, connection } = getVoiceFn();
        return await MusicManager.cmdPlayModal(interaction, queueKey, {
          player,
          connection,
          voiceChannelId,
        });
      }

      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const handled = await MusicManager.handleInteraction(
          interaction, queueKey, interaction.guild, getVoiceFn,
        );
        if (!handled && interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: t('music.connectionNotReady'),
            flags: Ephemeral,
          }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
        }
      }
    } catch (err) {
      logMusicError(err, 'interaction', { queueKey });
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: formatMusicError(err, 'search'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('MUSIC', err, 'command'));
      }
    }
    });
  };

  const onVoiceState = (oldState, newState) => {
    if (!slaveMode) {
      const guildId = newState.guild?.id ?? oldState.guild?.id;
      if (!guildId) return;
      const vk = queueKeyForGuild(guildId);
      MusicManager.onVoiceStateUpdate(vk, globalVoice.getVoiceChannelId(guildId), oldState, newState);
      return;
    }
    const vk = sharedPool
      ? resolveSlaveQueueKeyForClient(
        client,
        newState.guild?.id ?? oldState.guild?.id,
        null,
      )
      : bridgeOpts.queueKey;
    if (!vk) return;
    MusicManager.onVoiceStateUpdate(vk, roomForQueue(vk).voiceChannelId, oldState, newState);
  };

  client._musicMessageHandler = safeListener('[MUSIC]', onMessage);
  client._musicInteractionHandler = safeListener('[MUSIC]', onInteraction);
  client._musicVoiceStateHandler = safeListener('[MUSIC]', onVoiceState);
  client.on('messageCreate', client._musicMessageHandler);
  client.prependListener('interactionCreate', client._musicInteractionHandler);
  client.on('voiceStateUpdate', client._musicVoiceStateHandler);
}

module.exports = { attachMusicCommands, updateMusicRoom, syncGlobalGuildRoom };
