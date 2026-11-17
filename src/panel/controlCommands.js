// controlCommands.js – Discord panel on MASTER bot (panel / لوحة)
const registry = require('../bridge/registry');
const localeStore = require('../i18n/localeStore');
const { runWithLocale, t } = require('../i18n/context');
const { isPanelCommand } = require('../i18n');
const { Ephemeral } = require('../util/interactionFlags');
const { safeListener } = require('../util/safeListener');
const {
  buildPanel,
  parseBridgeId,
  parseListPage,
  parseRoomsNavExtra,
  parseBotEditNav,
  parseUserMuteNavExtra,
  botEditNav,
  panelViewFromMessage,
  themeForSlave,
  slaveRoomLabel,
} = require('./controlUI');
const { handlePermsInteraction } = require('./permsPanel');
const {
  BULK_BOT_KEY,
  buildIdentityModal,
  buildBulkIdentityModal,
  buildBannerModal,
  buildBulkBannerModal,
  buildPresenceHubModal,
  buildBulkPresenceHubModal,
  parseProfileModalId,
  parseIdentityModalId,
  parseBannerModalId,
  parsePresenceHubModalId,
  parseActivityProfileModalId,
  saveAndApplyBulk,
  saveAndApplyIdentity,
  saveAndApplyBanner,
  saveAndApplyPresence,
  saveAndApplyBannerBulk,
  saveAndApplyPresenceBulk,
  clearAndReset,
  clearAllProfiles,
  formatBulkResultLines,
  getClientForBotKey,
  bulkEditWaitMessage,
  getGuildBulkConnectionStatus,
} = require('./botProfile');
const { setBotVoiceChannel, setBotTextChannel, confirmBotVoiceJoin } = require('./botChannel');
const { toggleBotPause, pauseAllSlaves, resumeAllSlaves } = require('./botPause');
const { slaveQueueKey } = require('../music/slaveQueueKey');
const MusicManager = require('../music/MusicManager');
const { buildNowPlayingEmbed, buildControls } = require('../music/musicUI');
const { logDiscordFailure } = require('../util/logger');
const { parseUserSourceKey } = require('../bridge/sourceKey');
const { removeSlaveBot } = require('../config/removeSlave');
const { addSlaveBot } = require('../config/addSlave');
const { ensureSlaveRunning } = require('../config/slaveRuntime');
const {
  saveAllowedChatRoles,
  saveAllowedChatRolesBulk,
  formatAllowedChatRoles,
} = require('./chatAccess');
const {
  parseRemoveBotModalId,
  buildRemoveBotModal,
} = require('./removeBotUI');
const {
  parseAddBotModalId,
  buildAddBotModal,
} = require('./addBotUI');
const { checkPanelGuild, isAssignedMusicTextChannel } = require('../subscription/guildRoomAccess');
const { guildBridgeEnabled, guildSlavesEnabled, guildSlaveProfileEditEnabled } = require('./guildPanelFeatures');
const { toggleVoteToSkip } = require('./musicSkipSettings');
const panelSections = require('./panelSections');

/** T81: refuse a panel click on a section the bot management hid / made view-only for this admin. */
async function rejectSection(interaction, sec) {
  const key = panelSections.blockReason(interaction.member, interaction.guild?.id, sec);
  if (!key) return false;
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: t(key), flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
  return true;
}

function panelSubscriptionReply() {
  const url = process.env.SUBSCRIPTION_URL?.trim();
  return url ? t('sub.notSubscribedUrl', { url }) : t('sub.notSubscribed');
}

function slavesPanelActionAllowed(action, target, extra) {
  if (action === 'bot' && (target === 'add' || target === 'remove' || target === 'removepick')) return true;
  if (action === 'profile' && extra === BULK_BOT_KEY) return true;
  if (action === 'view' && (target === 'slave' || target === 'rooms')) return true;
  if (action === 'refresh' && (target === 'slave' || target === 'rooms')) return true;
  if (action === 'navslave' || action === 'navroom') return true;
  if (action === 'room' && extra && extra !== 'master') return true;
  if (action === 'botedit' && extra) {
    const { botKey, returnView } = parseBotEditNav(extra);
    if (botKey !== 'master' || returnView === 'slave' || returnView === 'remove') return true;
  }
  if (action === 'action' && target === 'slave' && extra) {
    if (extra.startsWith('reconnect:') || extra.startsWith('togglepause:') || extra.startsWith('togglevoteskip:') || extra === 'reconnect') {
      return true;
    }
  }
  return false;
}

function bridgeOnlyPanelActionBlocked(action, target, extra) {
  if (action === 'view' && target === 'mixer') return true;
  if (action === 'refresh' && target === 'mixer') return true;
  if (action === 'bridge' || action === 'mute' || action === 'solo' || action === 'navslave') return true;
  if (action === 'usermutesel') return true;
  if (action === 'mutesel' && target === 'mixer') return true;
  if (action === 'solosel' && target === 'mixer') return true;
  if (action === 'volsel' || action === 'volmix' || action === 'music') return true;
  if (action === 'action' && (target === 'mixer' || target === 'slave')) return true;
  if (action === 'action' && target === 'all' && extra !== 'pause' && extra !== 'resume') return true;
  if (action === 'action' && target === 'master' && extra === 'bridge') return true;
  if (action === 'listpage' && (target === 'mixer' || target === 'usermute')) return true;
  if (action === 'view' && target === 'slave') return true;
  if (action === 'refresh' && target === 'slave') return true;
  if (action === 'room' && extra && extra !== 'master') return true;
  if (action === 'profile' && extra === BULK_BOT_KEY) return true;
  if (action === 'bot' && (target === 'add' || target === 'remove' || target === 'removepick')) return true;
  if (action === 'botedit' && extra) {
    const { botKey, returnView } = parseBotEditNav(extra);
    if (botKey !== 'master' || returnView === 'slave' || returnView === 'remove') return true;
  }
  return false;
}

function panelFeatureBlockedMessage(interaction, action, target, extra) {
  if (guildSlavesEnabled(interaction.guild)) return t('cmd.bridgeFeatureDisabled');
  if (slavesPanelActionAllowed(action, target, extra)) {
    return t('cmd.slavesFeatureDisabled');
  }
  return t('cmd.bridgeFeatureDisabled');
}

async function rejectBridgeDisabled(interaction, action, target, extra) {
  if (guildBridgeEnabled(interaction.guild)) return false;
  if (guildSlavesEnabled(interaction.guild) && slavesPanelActionAllowed(action, target, extra)) {
    return false;
  }
  if (!bridgeOnlyPanelActionBlocked(action, target, extra)) return false;
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({
      content: panelFeatureBlockedMessage(interaction, action, target, extra),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
  return true;
}

function botLabel(guild, botKey) {
  return botKey === 'master' ? 'Master' : slaveRoomLabel(guild, botKey);
}

function resolveSlaveQueue(guild, slaveName) {
  const entry = registry.getSlaveEntry(guild.id, slaveName);
  if (!entry) return null;
  const queueKey = slaveQueueKey({ name: slaveName, guildId: guild.id });
  const queue = MusicManager.getQueue(queueKey);
  const voiceId = queue.voiceChannelId || entry.cfg?.channelId;
  if (voiceId && !queue.voiceChannelId) queue.voiceChannelId = voiceId;
  MusicManager.syncRoomRoster(queue, guild);
  return queue;
}

async function resolvePanelMember(message) {
  if (message.member) return message.member;
  if (!message.guild) return null;
  try {
    return await message.guild.members.fetch(message.author.id);
  } catch {
    return null;
  }
}

function formatVoiceJoinConfirm(result) {
  if (!result) return null;
  switch (result.status) {
    case 'master_ok':
      return t('cmd.voiceJoinOrganized', { label: result.label, voice: result.voice });
    case 'master_partial':
      return t('cmd.voiceJoinPartial', { label: result.label, voice: result.voice });
    case 'ok':
      return t('cmd.voiceJoinOk', { label: result.label, voice: result.voice });
    case 'collision':
      return t('cmd.voiceJoinCollision', { label: result.label, voice: result.voice });
    case 'access_failed':
      return t('cmd.voiceJoinAccessFailed', {
        label: result.label,
        voice: result.voice,
        missing: result.missing || '?',
      });
    case 'paused':
      return t('cmd.voiceJoinPaused', { label: result.label });
    case 'failed':
      return t('cmd.voiceJoinFailed', { label: result.label, voice: result.voice });
    default:
      return null;
  }
}

function attachControlPanel(client) {
  if (client._panelHandlersAttached) return;
  client._panelHandlersAttached = true;

  registry.setControlClient(client.user.id);

  client.on('messageCreate', safeListener('[PANEL]', async (message) => {
    if (message.author.bot || !message.guild || !registry.isControlBot(client)) return;

    const lower = message.content.trim().toLowerCase();
    if (!isPanelCommand(lower)) return;

    const lang = localeStore.resolveFromMessage(message);

    return runWithLocale(lang, async () => {
      if (!isAssignedMusicTextChannel(message.guild.id, message.channelId)) return;
      if (!checkPanelGuild(message.guild?.id)) return;
      const member = await resolvePanelMember(message);
      if (!registry.canUsePanel(member)) {
        return message.reply(t('cmd.noPermission'));
      }
      const payload = panelSections.runWithViewer(member, () => buildPanel('main', message.guild));
      return message.reply(payload);
    });
  }));

  client.on('interactionCreate', safeListener('[PANEL]', async (interaction) => {
    if (!registry.isControlBot(client)) return;
    if (interaction.customId?.startsWith('music:')) return;

    if (interaction.guild && !checkPanelGuild(interaction.guild.id)) return;

    if (interaction.guild?.id && interaction.channelId
      && !isAssignedMusicTextChannel(interaction.guild.id, interaction.channelId)) {
      return;
    }

    const lang = localeStore.resolveFromInteraction(interaction);
    return panelSections.runWithViewer(interaction.member, () => runWithLocale(lang, async () => {
    const identityModal = parseIdentityModalId(interaction.customId)
      || parseProfileModalId(interaction.customId);
    const bannerModal = parseBannerModalId(interaction.customId);
    const presenceModal = parsePresenceHubModalId(interaction.customId)
      || parseActivityProfileModalId(interaction.customId);
    const removeBotModal = parseRemoveBotModalId(interaction.customId);
    const addBotModal = parseAddBotModalId(interaction.customId);

    if (interaction.isModalSubmit() && (identityModal || bannerModal || presenceModal || removeBotModal || addBotModal)
      && registry.canUsePanel(interaction.member)
      && await rejectSection(interaction, { section: 'botEdit', write: true })) return;

    if (interaction.isModalSubmit() && addBotModal) {
      if (!registry.canUsePanel(interaction.member)) {
        return interaction.reply({
          content: t('cmd.noPanelPermission'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
      return handleAddBotModal(interaction);
    }

    if (interaction.isModalSubmit() && removeBotModal) {
      if (!registry.canUsePanel(interaction.member)) {
        return interaction.reply({
          content: t('cmd.noPanelPermission'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
      return handleRemoveBotModal(interaction, removeBotModal.botKey);
    }

    if (interaction.isModalSubmit() && identityModal) {
      if (!registry.canUsePanel(interaction.member)) {
        return interaction.reply({
          content: t('cmd.noPanelPermission'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
      return handleIdentityModal(interaction, identityModal.botKey);
    }

    if (interaction.isModalSubmit() && bannerModal) {
      if (!registry.canUsePanel(interaction.member)) {
        return interaction.reply({
          content: t('cmd.noPanelPermission'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
      return handleBannerModal(interaction, bannerModal.botKey);
    }

    if (interaction.isModalSubmit() && presenceModal) {
      if (!registry.canUsePanel(interaction.member)) {
        return interaction.reply({
          content: t('cmd.noPanelPermission'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
      return handlePresenceModal(interaction, presenceModal.botKey);
    }

    if (!interaction.customId?.startsWith('bridge:')) return;

    const parsed = parseBridgeId(interaction.customId);
    if (!parsed) return;

    if (!registry.canUsePanel(interaction.member)) {
      if (interaction.isRepliable()) {
        return interaction.reply({
          content: t('cmd.noPanelPermission'),
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
      return;
    }

    if (await rejectSection(interaction, panelSections.sectionFor(parsed))) return;

    try {
      if (await handlePermsInteraction(interaction, buildPanel)) return;
      if (interaction.isButton()) {
        await handleButton(interaction, parsed);
      } else if (interaction.isChannelSelectMenu()) {
        await handleChannelSelect(interaction, parsed);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelect(interaction, parsed);
      } else if (interaction.isRoleSelectMenu()) {
        await handleRoleSelect(interaction, parsed);
      }
    } catch (err) {
      console.error('[PANEL] Interaction error:', err.message);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ ${err.message}`, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
    }
    }));
  }));
}

function readIdentityModalFields(interaction) {
  return {
    username: interaction.fields.getTextInputValue('username'),
    display_name: interaction.fields.getTextInputValue('display_name'),
    avatar_url: interaction.fields.getTextInputValue('avatar_url'),
    description: interaction.fields.getTextInputValue('description'),
  };
}

function readBannerModalFields(interaction) {
  return {
    banner_color: interaction.fields.getTextInputValue('banner_color'),
    banner_url: interaction.fields.getTextInputValue('banner_url'),
  };
}

function readPresenceModalFields(interaction) {
  return {
    presence_status: interaction.fields.getTextInputValue('presence_status'),
    activity_type: interaction.fields.getTextInputValue('activity_type'),
    activity_text: interaction.fields.getTextInputValue('activity_text'),
    stream_url: interaction.fields.getTextInputValue('stream_url'),
  };
}

function botEditReturnView(botKey) {
  if (botKey === BULK_BOT_KEY) return 'main';
  if (botKey === 'master') return 'master';
  return 'slave';
}

function isProfileEditBlocked(guild, botKey) {
  if (botKey === 'master') return true;
  return !guildSlaveProfileEditEnabled(guild);
}

function profileEditBlockedReply(botKey) {
  return botKey === 'master' ? t('cmd.masterProfileLocked') : t('cmd.slaveEditDisabled');
}

function bulkEditIncomplete(guildId) {
  const st = getGuildBulkConnectionStatus(guildId);
  return st.total > 0 && !st.allConnected;
}

async function rejectBulkEditIfIncomplete(interaction, guild) {
  if (!bulkEditIncomplete(guild?.id)) return false;
  await interaction.reply({ content: bulkEditWaitMessage(guild.id), flags: Ephemeral });
  return true;
}

async function handleIdentityModal(interaction, botKey) {
  if (isProfileEditBlocked(interaction.guild, botKey)) {
    return interaction.reply({ content: profileEditBlockedReply(botKey), flags: Ephemeral });
  }
  await interaction.deferReply({ flags: Ephemeral });
  const raw = readIdentityModalFields(interaction);

  try {
    if (botKey === BULK_BOT_KEY) {
      if (bulkEditIncomplete(interaction.guild.id)) {
        return interaction.editReply({ content: bulkEditWaitMessage(interaction.guild.id) });
      }
      const results = await saveAndApplyBulk(raw, interaction.guild.id);
      return interaction.editReply({ content: formatBulkResultLines(results) });
    }

    const client = getClientForBotKey(botKey, interaction.guild.id);
    if (!client?.user) {
      return interaction.editReply({ content: t('cmd.botNotConnected') });
    }

    const result = await saveAndApplyIdentity(client, botKey, raw, '[PROFILE]', interaction.guild.id);
    const label = botLabel(interaction.guild, botKey);
    const applied = result.applied?.length ? result.applied.join(', ') : t('profile.savedOnly');
    const warn = result.errors?.length ? `\n⚠️ ${result.errors.join('; ')}` : '';
    await interaction.editReply({
      content: `${t('profile.saved.identity', { label, applied })}${warn}`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ ${err.message}` }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handleBannerModal(interaction, botKey) {
  if (isProfileEditBlocked(interaction.guild, botKey)) {
    return interaction.reply({ content: profileEditBlockedReply(botKey), flags: Ephemeral });
  }
  await interaction.deferReply({ flags: Ephemeral });
  const raw = readBannerModalFields(interaction);

  try {
    if (botKey === BULK_BOT_KEY) {
      if (bulkEditIncomplete(interaction.guild.id)) {
        return interaction.editReply({ content: bulkEditWaitMessage(interaction.guild.id) });
      }
      const results = await saveAndApplyBannerBulk(raw, interaction.guild.id);
      return interaction.editReply({ content: formatBulkResultLines(results) });
    }

    const client = getClientForBotKey(botKey, interaction.guild.id);
    if (!client?.user) {
      return interaction.editReply({ content: t('cmd.botNotConnected') });
    }

    const result = await saveAndApplyBanner(client, botKey, raw, '[PROFILE]', interaction.guild.id);
    const label = botLabel(interaction.guild, botKey);
    const applied = result.applied?.length ? result.applied.join(', ') : t('profile.savedOnly');
    const warn = result.errors?.length ? `\n⚠️ ${result.errors.join('; ')}` : '';
    await interaction.editReply({
      content: `${t('profile.saved.banner', { label, applied })}${warn}`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ ${err.message}` }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handleAddBotModal(interaction) {
  await interaction.deferUpdate();
  const token = interaction.fields.getTextInputValue('bot_token');

  try {
    const result = await addSlaveBot({ token, guildId: interaction.guild.id });
    const payload = buildPanel('botedit', interaction.guild, botEditNav(BULK_BOT_KEY, 'main'), 0);
    await interaction.editReply(payload);

    let msg = result.started
      ? t('cmd.slaveAdded', { name: result.name })
      : t('cmd.slaveSaved', { name: result.name });
    if (result.needsRoom) {
      msg += t('cmd.assignRooms');
    }
    return interaction.followUp({ content: msg, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  } catch (err) {
    return interaction.followUp({
      content: `❌ ${err.message}`,
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handleRemoveBotModal(interaction, botKey) {
  const confirm = interaction.fields.getTextInputValue('confirm').trim().toUpperCase();
  if (confirm !== 'REMOVE') {
    return interaction.reply({
      content: t('cmd.removeCancelled'),
      flags: Ephemeral,
    });
  }

  await interaction.deferUpdate();
  try {
    const { removed, disconnected } = await removeSlaveBot(botKey, interaction.guild.id);
    if (!removed) {
      return interaction.followUp({
        content: t('cmd.botNotInConfig'),
        flags: Ephemeral,
      }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    }

    const payload = buildPanel('botedit', interaction.guild, botEditNav(BULK_BOT_KEY, 'main'), 0);
    await interaction.editReply(payload);
    const label = slaveRoomLabel(interaction.guild, botKey);
    const note = disconnected ? t('cmd.disconnected') : '';
    return interaction.followUp({
      content: t('cmd.slaveRemoved', { label, note }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  } catch (err) {
    return interaction.followUp({
      content: `❌ ${err.message}`,
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handlePresenceModal(interaction, botKey) {
  if (isProfileEditBlocked(interaction.guild, botKey)) {
    return interaction.reply({ content: profileEditBlockedReply(botKey), flags: Ephemeral });
  }
  await interaction.deferReply({ flags: Ephemeral });
  const raw = readPresenceModalFields(interaction);

  try {
    if (botKey === BULK_BOT_KEY) {
      if (bulkEditIncomplete(interaction.guild.id)) {
        return interaction.editReply({ content: bulkEditWaitMessage(interaction.guild.id) });
      }
      const results = await saveAndApplyPresenceBulk(raw, interaction.guild.id);
      return interaction.editReply({ content: formatBulkResultLines(results) });
    }

    const client = getClientForBotKey(botKey, interaction.guild.id);
    if (!client?.user) {
      return interaction.editReply({ content: t('cmd.botNotConnected') });
    }

    const result = await saveAndApplyPresence(client, botKey, raw, '[PROFILE]', interaction.guild.id);
    const label = botLabel(interaction.guild, botKey);
    const applied = result.applied?.length ? result.applied.join(', ') : t('profile.savedOnly');
    const warn = result.errors?.length ? `\n⚠️ ${result.errors.join('; ')}` : '';
    await interaction.editReply({
      content: `${t('profile.saved.presence', { label, applied })}${warn}`,
    });
  } catch (err) {
    await interaction.editReply({ content: `❌ ${err.message}` }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handleButton(interaction, parsed) {
  const { action, target, extra } = parsed;
  const guild = interaction.guild;

  if (await rejectBridgeDisabled(interaction, action, target, extra)) return;

  if (action === 'profile' && target === 'edit' && extra) {
    const returnView = extra === BULK_BOT_KEY ? 'main' : botEditReturnView(extra);
    const payload = buildPanel('botedit', guild, botEditNav(extra, returnView), 0);
    return interaction.update(payload);
  }

  if (action === 'profile' && target === 'activity' && extra) {
    const returnView = extra === BULK_BOT_KEY ? 'main' : botEditReturnView(extra);
    const payload = buildPanel('botedit', guild, botEditNav(extra, returnView), 0);
    return interaction.update(payload);
  }

  if (action === 'bot' && target === 'add') {
    return interaction.showModal(buildAddBotModal());
  }

  if (action === 'bot' && target === 'remove' && extra === 'bulk') {
    const payload = buildPanel('botedit', guild, botEditNav(BULK_BOT_KEY, 'remove'), 0);
    return interaction.update(payload);
  }

  if (action === 'profile' && target === 'identity' && extra) {
    if (isProfileEditBlocked(guild, extra)) {
      return interaction.reply({ content: profileEditBlockedReply(extra), flags: Ephemeral });
    }
    if (extra === BULK_BOT_KEY && await rejectBulkEditIfIncomplete(interaction, guild)) return;
    const modal = extra === BULK_BOT_KEY
      ? buildBulkIdentityModal(guild)
      : buildIdentityModal(extra, guild);
    return interaction.showModal(modal);
  }

  if (action === 'profile' && target === 'banner' && extra) {
    if (isProfileEditBlocked(guild, extra)) {
      return interaction.reply({ content: profileEditBlockedReply(extra), flags: Ephemeral });
    }
    if (extra === BULK_BOT_KEY && await rejectBulkEditIfIncomplete(interaction, guild)) return;
    const modal = extra === BULK_BOT_KEY
      ? buildBulkBannerModal(guild)
      : buildBannerModal(extra, guild);
    return interaction.showModal(modal);
  }

  if (action === 'profile' && target === 'presence' && extra) {
    if (isProfileEditBlocked(guild, extra)) {
      return interaction.reply({ content: profileEditBlockedReply(extra), flags: Ephemeral });
    }
    if (extra === BULK_BOT_KEY && await rejectBulkEditIfIncomplete(interaction, guild)) return;
    const modal = extra === BULK_BOT_KEY
      ? buildBulkPresenceHubModal(guild)
      : buildPresenceHubModal(extra, guild);
    return interaction.showModal(modal);
  }

  if (action === 'profile' && target === 'clear' && extra === BULK_BOT_KEY) {
    if (isProfileEditBlocked(guild, BULK_BOT_KEY)) {
      return interaction.reply({ content: profileEditBlockedReply(BULK_BOT_KEY), flags: Ephemeral });
    }
    if (await rejectBulkEditIfIncomplete(interaction, guild)) return;
    await interaction.deferUpdate();
    const results = await clearAllProfiles(guild.id);
    const payload = buildPanel('botedit', guild, botEditNav(BULK_BOT_KEY, 'main'), 0);
    await interaction.editReply(payload);
    return interaction.followUp({
      content: formatBulkResultLines(results),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'profile' && target === 'clear' && extra) {
    if (isProfileEditBlocked(guild, extra)) {
      return interaction.reply({ content: profileEditBlockedReply(extra), flags: Ephemeral });
    }
    const client = getClientForBotKey(extra, guild.id);
    if (!client?.user) {
      return interaction.reply({ content: t('cmd.botNotConnected'), flags: Ephemeral });
    }
    const cleared = await clearAndReset(client, extra, '[PROFILE]', guild.id);
    const returnView = botEditReturnView(extra);
    const payload = buildPanel('botedit', guild, botEditNav(extra, returnView), 0);
    await interaction.update(payload);
    const label = botLabel(guild, extra);
    const note = cleared?.errors?.length ? `\n⚠️ ${cleared.errors.join('; ')}` : '';
    return interaction.followUp({
      content: `${t('cmd.profileCleared', { label })}${note}`,
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'listpage' && target) {
    const listPage = parseListPage(extra);
    if (target === 'rooms') {
      const { botKey } = parseRoomsNavExtra(extra);
      const payload = buildPanel('rooms', guild, botKey, listPage);
      return interaction.update(payload);
    }
    if (target === 'usermute') {
      const { userMutePage, view, slaveName } = parseUserMuteNavExtra(extra);
      const payload = view === 'slave'
        ? buildPanel('slave', guild, slaveName, 0, userMutePage)
        : buildPanel('mixer', guild, null, 0, userMutePage);
      return interaction.update(payload);
    }
    const view = target === 'mixer' ? 'mixer' : 'main';
    const payload = buildPanel(view, guild, null, listPage);
    return interaction.update(payload);
  }

  if (action === 'botedit' && target === 'back' && extra) {
    const { botKey, returnView } = parseBotEditNav(extra);
    const payload = returnView === 'slave'
      ? buildPanel('slave', guild, botKey, 0)
      : returnView === 'master'
        ? buildPanel('master', guild)
        : buildPanel('main', guild, null, 0);
    return interaction.update(payload);
  }

  if (action === 'refresh' || action === 'view') {
    if (target === 'rooms') {
      const { listPage, botKey } = parseRoomsNavExtra(extra);
      const payload = buildPanel('rooms', guild, botKey, listPage);
      return interaction.update(payload);
    }
    if (target === 'botedit') {
      const payload = buildPanel('botedit', guild, extra, 0);
      return interaction.update(payload);
    }
    const view = action === 'refresh' ? (target || 'main') : target;
    const slaveName = view === 'slave' ? extra : (view === 'botedit' ? extra : null);
    const listPage = (view === 'slave' || view === 'botedit') ? 0 : parseListPage(extra);
    const payload = buildPanel(view, guild, slaveName, listPage);
    return interaction.update(payload);
  }

  if (action === 'bridge' && target === 'toggle' && extra) {
    const enabled = registry.toggleBridgeEnabled(extra, guild.id);
    await interaction.deferUpdate();
    const payload = buildPanel('slave', guild, extra, 0);
    await interaction.editReply(payload);
    const label = slaveRoomLabel(guild, extra);
    return interaction.followUp({
      content: enabled ? t('cmd.bridgeEnabled', { label }) : t('cmd.bridgeDisabled', { label }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'mute' && target) {
    const muted = registry.toggleBridgeMute(target, guild.id);
    const payload = buildPanel('mixer', guild, null, 0);
    await interaction.update(payload);
    const label = slaveRoomLabel(guild, target);
    return interaction.followUp({
      content: muted ? t('cmd.muted', { label }) : t('cmd.unmuted', { label }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'solo' && target) {
    const active = registry.toggleBridgeSolo(target, guild.id);
    const view = extra === 'slave' ? 'slave' : 'mixer';
    const payload = buildPanel(view, guild, view === 'slave' ? target : null, 0);
    await interaction.update(payload);
    const label = slaveRoomLabel(guild, target);
    return interaction.followUp({
      content: active ? t('cmd.soloOn', { label }) : t('cmd.soloOff'),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'action' && target === 'mixer' && (extra === 'muteall' || extra === 'unmuteall' || extra === 'resetvol')) {
    await interaction.deferUpdate();
    let message;
    if (extra === 'muteall') {
      const names = registry.muteAllBridgeSources(guild.id);
      message = names.length
        ? t('cmd.mutedAll', { count: names.length, names: names.join(', ') })
        : t('cmd.noSlavesAction', { action: 'mute' });
    } else if (extra === 'unmuteall') {
      const names = registry.unmuteAllBridgeSources(guild.id);
      message = names.length
        ? t('cmd.unmutedAll', { count: names.length, names: names.join(', ') })
        : t('cmd.noSlavesAction', { action: 'unmute' });
    } else {
      const names = registry.resetAllBridgeVolumes(100, guild.id);
      message = names.length
        ? t('cmd.resetVol', { count: names.length, names: names.join(', ') })
        : t('cmd.noSlavesAction', { action: 'reset' });
    }
    const payload = buildPanel('mixer', guild, null, 0);
    await interaction.editReply(payload);
    return interaction.followUp({ content: message, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'action' && target === 'all' && (extra === 'pause' || extra === 'resume')) {
    await interaction.deferUpdate();
    const names = extra === 'pause'
      ? await pauseAllSlaves(guild)
      : await resumeAllSlaves(guild);
    const payload = buildPanel('main', guild, null, 0);
    await interaction.editReply(payload);
    const verb = extra === 'pause' ? t('cmd.verbPaused') : t('cmd.verbResumed');
    const list = names.length ? names.join(', ') : t('cmd.noneActive');
    return interaction.followUp({
      content: t('cmd.pausedSlaves', { verb, list }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'action' && target === 'master') {
    const m = registry.state.master;
    if (!m) {
      return interaction.reply({ content: t('cmd.masterNotReady'), flags: Ephemeral });
    }
    if (extra === 'togglepause') {
      await interaction.deferUpdate();
      const r = await toggleBotPause('master', guild);
      const payload = buildPanel('master', guild);
      await interaction.editReply(payload);
      return interaction.followUp({
        content: r.paused ? t('cmd.paused', { label: r.label }) : t('cmd.resumed', { label: r.label }),
        flags: Ephemeral,
      }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    }
    if (extra === 'togglevoteskip') {
      await interaction.deferUpdate();
      const enabled = toggleVoteToSkip('master', guild.id);
      const payload = buildPanel('main', guild);
      await interaction.editReply(payload);
      return interaction.followUp({
        content: enabled ? t('cmd.voteSkipDefaultOn') : t('cmd.voteSkipDefaultOff'),
        flags: Ephemeral,
      }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    }
    if (extra === 'reconnect') {
      await interaction.deferUpdate();
      // Rejoin this guild's master voice room only (the master client serves every guild).
      const globalVoice = require('../bots/globalVoice');
      const { repairGuildMasterRoom } = require('../subscription/guildRoomRecovery');
      globalVoice.destroyGuildVoice(guild.id);
      setTimeout(() => {
        repairGuildMasterRoom(m.client, guild.id, '[PANEL]').catch((err) =>
          console.warn(`[PANEL] Master rejoin failed for ${guild.id}: ${err.message}`));
      }, 1200);
      return interaction.followUp({ content: t('cmd.masterReconnecting'), flags: Ephemeral });
    }
    if (extra === 'bridge') {
      if (guild?.id) {
        const { restartGuildBridge } = require('../bots/globalBridge');
        restartGuildBridge(guild.id);
      } else {
        m.client?.startBridge?.();
      }
      const payload = buildPanel('master', guild);
      await interaction.update(payload);
      return interaction.followUp({ content: t('cmd.bridgeRestarted'), flags: Ephemeral });
    }
  }

  if (action === 'action' && target === 'slave' && extra?.startsWith('togglepause:')) {
    const name = extra.split(':')[1];
    const entry = registry.getSlaveEntry(guild.id, name);
    if (!entry) {
      return interaction.reply({ content: t('cmd.slaveNotFound'), flags: Ephemeral });
    }
    await interaction.deferUpdate();
    const r = await toggleBotPause(name, guild);
    const payload = buildPanel('slave', guild, name, 0);
    await interaction.editReply(payload);
    return interaction.followUp({
      content: r.paused ? t('cmd.paused', { label: r.label }) : t('cmd.resumed', { label: r.label }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'action' && target === 'slave' && extra?.startsWith('togglevoteskip:')) {
    const name = extra.split(':')[1];
    const entry = registry.getSlaveEntry(guild.id, name);
    if (!entry) {
      return interaction.reply({ content: t('cmd.slaveNotFound'), flags: Ephemeral });
    }
    const queue = resolveSlaveQueue(guild, name);
    if (!queue?.roomOwnerId) {
      return interaction.reply({
        content: t('cmd.voteSkipNoOwner'),
        flags: Ephemeral,
      });
    }
    if (interaction.user.id !== queue.roomOwnerId) {
      return interaction.reply({
        content: t('cmd.voteSkipOwnerOnly'),
        flags: Ephemeral,
      });
    }
    await interaction.deferUpdate();
    const enabled = toggleVoteToSkip(name, guild.id);
    const payload = buildPanel('slave', guild, name, 0);
    await interaction.editReply(payload);
    return interaction.followUp({
      content: enabled ? t('cmd.voteSkipOn', { label: botLabel(guild, name) }) : t('cmd.voteSkipOff', { label: botLabel(guild, name) }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'action' && target === 'slave' && extra?.startsWith('reconnect:')) {
    const name = extra.split(':')[1];
    await interaction.deferUpdate();
    try {
      const r = await ensureSlaveRunning(name, guild.id);
      const fromRooms = panelViewFromMessage(interaction);
      const payload = fromRooms
        ? buildPanel('rooms', guild, name, 0)
        : buildPanel('slave', guild, name, 0);
      await interaction.editReply(payload);
      const msg = r.action === 'started'
        ? t('cmd.slaveStarted', { name })
        : t('cmd.slaveReconnecting', { name });
      return interaction.followUp({ content: msg, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    } catch (err) {
      return interaction.followUp({ content: `❌ ${err.message}`, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    }
  }

  if (action === 'music' && target) {
    const queueKey = slaveQueueKey({ name: target, guildId: guild.id });
    const queue = MusicManager.getQueue(queueKey);
    if (!queue.current) {
      return interaction.reply({
        content: t('cmd.noTrack', { label: slaveRoomLabel(guild, target) }),
        flags: Ephemeral,
      });
    }
    const saved = MusicManager.getSavedPlaylists(queueKey);
    const embed = buildNowPlayingEmbed(queue, queueKey);
    return interaction.reply({
      content: t('cmd.musicControls', { label: slaveRoomLabel(guild, target) }),
      embeds: [embed],
      components: buildControls(queue, queueKey, saved),
      flags: Ephemeral,
    });
  }
}

async function handleChannelSelect(interaction, parsed) {
  const { action, target, extra } = parsed;
  if (await rejectBridgeDisabled(interaction, action, target, extra)) return;
  if (action !== 'room' || !extra) return;

  const channelId = interaction.values[0];
  await interaction.deferUpdate();

  try {
    let label;
    let reply;
    let voiceResult = null;
    const fromRooms = panelViewFromMessage(interaction);
    const view = fromRooms || (extra === 'master' ? 'master' : 'slave');
    const panelBot = view === 'rooms' ? extra : (view === 'slave' ? extra : null);

    if (target === 'voice') {
      voiceResult = await setBotVoiceChannel(extra, channelId, interaction.guild);
      label = voiceResult.label;
      if (voiceResult.reverted) {
        const attempted = interaction.guild.channels.cache.get(voiceResult.attemptedChannelId);
        const attemptedName = attempted ? `**#${attempted.name}**` : 'that room';
        reply = t('cmd.voiceCannotManage', { label, channel: attemptedName });
      } else if (voiceResult.fellBackToMaster) {
        const attempted = interaction.guild.channels.cache.get(voiceResult.attemptedChannelId);
        const attemptedName = attempted ? `**#${attempted.name}**` : 'that room';
        const ch = interaction.guild.channels.cache.get(voiceResult.channelId);
        const chName = ch ? `**#${ch.name}**` : `\`${voiceResult.channelId}\``;
        reply = t('cmd.voiceSlaveFellBack', { label, channel: attemptedName, master: chName });
      } else {
        const ch = interaction.guild.channels.cache.get(voiceResult.channelId);
        const chName = ch ? `**#${ch.name}**` : `\`${voiceResult.channelId}\``;
        const chat = interaction.guild.channels.cache.get(voiceResult.textChannelId);
        const chatName = chat ? `**#${chat.name}**` : 'voice chat';
        reply = voiceResult.savedOnly
          ? t('cmd.voiceSaved', { label, voice: chName, chat: chatName })
          : t('cmd.voiceSet', { label, voice: chName, chat: chatName });
      }
    } else if (target === 'text') {
      const r = await setBotTextChannel(extra, channelId, interaction.guild);
      label = r.label;
      const ch = interaction.guild.channels.cache.get(r.textChannelId);
      const chName = ch ? `**#${ch.name}**` : `\`${r.textChannelId}\``;
      reply = r.savedOnly
        ? t('cmd.chatSaved', { label, chat: chName })
        : t('cmd.chatSet', { label, chat: chName });
    } else {
      return;
    }

    const payload = buildPanel(view, interaction.guild, panelBot, 0);
    await interaction.editReply(payload);
    await interaction.followUp({ content: reply, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));

    if (
      target === 'voice'
      && extra !== 'master'
      && voiceResult?.savedOnly
      && guildSlavesEnabled(interaction.guild)
    ) {
      try {
        const entry = registry.getSlaveEntry(interaction.guild.id, extra);
        let r;
        if (entry?.client) {
          entry.reconnect?.();
          r = { action: 'reconnect' };
        } else {
          r = await ensureSlaveRunning(extra, interaction.guild.id);
        }
        const startMsg = r.action === 'started'
          ? t('cmd.slaveStarted', { name: extra })
          : t('cmd.slaveReconnecting', { name: extra });
        await interaction.followUp({ content: startMsg, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
        const refresh = buildPanel(view, interaction.guild, panelBot, 0);
        await interaction.editReply(refresh).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      } catch (err) {
        await interaction.followUp({
          content: `❌ ${err.message}`,
          flags: Ephemeral,
        }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
    } else if (target === 'voice' && voiceResult && !voiceResult.savedOnly && !voiceResult.reverted && voiceResult.channelId) {
      const confirm = await confirmBotVoiceJoin(extra, interaction.guild, voiceResult.channelId);
      const confirmMsg = formatVoiceJoinConfirm(confirm);
      if (confirmMsg) {
        await interaction.followUp({ content: confirmMsg, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
      }
    }
  } catch (err) {
    await interaction.followUp({
      content: `❌ ${err.message}`,
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handleSelect(interaction, parsed) {
  const { action, target, extra } = parsed;
  const guild = interaction.guild;
  const value = interaction.values[0];

  if (await rejectBridgeDisabled(interaction, action, target, extra)) return;

  if (action === 'navroom' && value !== 'master' && !guildSlavesEnabled(guild) && !guildBridgeEnabled(guild)) {
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: t('cmd.slavesFeatureDisabled'), flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    }
    return;
  }

  if (action === 'bot' && target === 'removepick') {
    return interaction.showModal(buildRemoveBotModal(value, guild));
  }

  if (action === 'navslave') {
    const payload = buildPanel('slave', guild, value, parseListPage(extra));
    return interaction.update(payload);
  }

  if (action === 'navroom') {
    const payload = buildPanel('rooms', guild, value, parseListPage(extra));
    return interaction.update(payload);
  }

  if (action === 'usermutesel') {
    const { userMutePage, view, slaveName } = parseUserMuteNavExtra(extra);
    const muted = registry.toggleUserBridgeMute(value);
    const payload = view === 'slave'
      ? buildPanel('slave', guild, slaveName, 0, userMutePage)
      : buildPanel('mixer', guild, null, 0, userMutePage);
    await interaction.update(payload);
    const parsed = parseUserSourceKey(value);
    const member = parsed ? guild.members.cache.get(parsed.userId) : null;
    const who = member?.displayName ?? value;
    const room = parsed ? slaveRoomLabel(guild, parsed.slaveName) : 'bridge';
    return interaction.followUp({
      content: muted ? t('cmd.userMuted', { who, room }) : t('cmd.userUnmuted', { who, room }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'mutesel' && target === 'mixer') {
    const muted = registry.toggleBridgeMute(value, guild.id);
    const listPage = parseListPage(extra);
    const payload = buildPanel('mixer', guild, null, listPage);
    await interaction.update(payload);
    const label = slaveRoomLabel(guild, value);
    return interaction.followUp({
      content: muted ? t('cmd.muted', { label }) : t('cmd.unmuted', { label }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if (action === 'solosel' && target === 'mixer') {
    const active = registry.setBridgeSoloFromSelect(value, guild.id);
    const listPage = parseListPage(extra);
    const payload = buildPanel('mixer', guild, null, listPage);
    await interaction.update(payload);
    const msg = active
      ? t('cmd.soloRoom', { label: slaveRoomLabel(guild, active) })
      : t('cmd.soloOffShort');
    return interaction.followUp({ content: msg, flags: Ephemeral }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }

  if ((action === 'volsel' || action === 'volmix') && target) {
    const vol = registry.setBridgeVolumeAbsolute(target, value, guild.id);
    const onMixer = action === 'volmix';
    const payload = buildPanel(onMixer ? 'mixer' : 'slave', guild, onMixer ? null : target, 0);
    await interaction.update(payload);
    return interaction.followUp({
      content: t('cmd.volumeSet', { label: slaveRoomLabel(guild, target), vol }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

async function handleRoleSelect(interaction, parsed) {
  const { action, target, extra } = parsed;
  if (await rejectBridgeDisabled(interaction, action, target, extra)) return;
  if (action !== 'roles' || target !== 'set' || !extra) return;

  const botKey = extra;
  const roleIds = interaction.values;

  await interaction.deferUpdate();

  try {
    if (botKey === BULK_BOT_KEY) {
      saveAllowedChatRolesBulk(roleIds, interaction.guild.id);
      const payload = buildPanel('botedit', interaction.guild, botEditNav(BULK_BOT_KEY, 'main'), 0);
      await interaction.editReply(payload);
      const summary = roleIds.length
        ? t('cmd.chatAccessRoles', { count: roleIds.length })
        : t('cmd.chatAccessAll');
      return interaction.followUp({
        content: t('cmd.chatAccessSaved', { summary }),
        flags: Ephemeral,
      }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
    }

    saveAllowedChatRoles(botKey, roleIds, interaction.guild.id);
    const returnView = botEditReturnView(botKey);
    const payload = buildPanel('botedit', interaction.guild, botEditNav(botKey, returnView), 0);
    await interaction.editReply(payload);
    const label = botLabel(interaction.guild, botKey);
    const roles = formatAllowedChatRoles(interaction.guild, botKey);
    return interaction.followUp({
      content: t('cmd.chatAccessBot', { label, roles }),
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  } catch (err) {
    await interaction.followUp({
      content: `❌ ${err.message}`,
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('PANEL', err, 'control'));
  }
}

module.exports = { attachControlPanel };
