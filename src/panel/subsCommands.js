const localeStore = require('../i18n/localeStore');
const { runWithLocale, t } = require('../i18n/context');
const { isSubsCommand, detectSubsLang } = require('../i18n');
const { safeListener } = require('../util/safeListener');
const { isSubsAdmin, isSubsAdminGuild } = require('../subscription/subsAccess');
const { isSubsAdminConfigured, getAdminGuildId, getSubsAuditChannelId } = require('../subscription/adminConfig');
const subscriptionStore = require('../subscription/subscriptionStore');
const subsAdminStore = require('../subscription/subsAdminStore');
const {
  getDraft,
  saveDraft,
  clearDraft,
  runBroadcast,
  countRecipients,
  targetLabel,
  isBusy: broadcastBusy,
} = require('./subsBroadcast');
const {
  buildListPanel,
  buildDetailPanel,
  buildHelpPanel,
  buildPermsPanel,
  buildBroadcastPanel,
  buildBroadcastPreviewPanel,
  buildBroadcastResultEmbed,
  buildBroadcastModal,
  buildAddPickPanel,
  buildRemoveConfirmPanel,
  buildAddModal,
  buildExpiresModal,
  buildLabelModal,
  buildNoteModal,
  buildMaxSlavesModal,
  parseSubsId,
  resolveGuildName,
  poolAddOptions,
  assignedRemoveOptions,
  extendExpires,
} = require('./subsUI');
const { Ephemeral } = require('../util/interactionFlags');
const {
  discordInteractionEditReply,
  discordInteractionUpdate,
} = require('../util/discordRetry');
const { logDiscordFailure } = require('../util/logger');
const { addSlaveBot } = require('../config/addSlave');
const { removeSlaveBot } = require('../config/removeSlave');
const { getPoolBot } = require('../config/slavePoolStore');
const { syncSubscribedSlaves } = require('../config/slaveSync');
const { notifyGuildOwnerBotInvite } = require('../subscription/subsOwnerNotify');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

async function deferSubsPanel(interaction) {
  if (interaction.deferred || interaction.replied) return;
  await interaction.deferUpdate().catch((err) => logDiscordFailure('SUBS', err, 'panel'));
}

async function editSubsPanel(interaction, payload) {
  if (interaction.deferred) {
    return discordInteractionEditReply(interaction, payload);
  }
  return discordInteractionUpdate(interaction, payload);
}

const TOGGLE_FIELDS = new Set([
  'active', 'music', 'bridge', 'slaves', 'lifetime', 'labelLocked', 'editSlaveProfile',
]);

function parseExpiresInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '-' || s.toLowerCase() === 'clear') return null;
  const iso = s.includes('T') ? s : `${s}T23:59:59.000Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function validGuildId(id) {
  return /^\d{17,20}$/.test(String(id ?? '').trim());
}

async function auditSubsChange(client, actorTag, text) {
  const guildId = getAdminGuildId();
  const chId = getSubsAuditChannelId();
  if (!guildId || !chId) return;
  const guild = client.guilds.cache.get(guildId)
    ?? await client.guilds.fetch(guildId).catch(() => null);
  const ch = guild?.channels?.cache?.get(chId)
    ?? await guild?.channels?.fetch(chId).catch(() => null);
  if (!ch?.isTextBased?.()) return;
  await ch.send(`**[SUBS]** ${actorTag}: ${text}`).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
}

async function resolveMember(source) {
  if (source.member) return source.member;
  const guild = source.guild;
  const userId = source.author?.id ?? source.user?.id;
  if (!guild || !userId) return null;
  return guild.members.cache.get(userId)
    ?? await guild.members.fetch(userId).catch(() => null);
}

function denySubs(interaction, ephemeral = true) {
  const hint = isSubsAdminGuild(interaction.guild?.id)
    ? t('subs.noPermissionHint')
    : t('subs.wrongGuild');
  const payload = { content: hint, flags: ephemeral ? Ephemeral : undefined };
  return interaction.reply(payload).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
}

function notConfiguredReply(target) {
  return target.reply({ content: t('subs.notConfigured') }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
}

async function addGuild(client, guildId, { label = null, actorTag = 'system' } = {}) {
  const patch = {};
  if (label) {
    patch.label = label;
    patch.labelLocked = true;
  } else {
    const g = client.guilds.cache.get(guildId)
      ?? await client.guilds.fetch(guildId).catch(() => null);
    if (g?.name) patch.label = g.name;
  }
  subscriptionStore.upsertGuild(guildId, patch);
  const name = resolveGuildName(client, guildId, patch.label);
  await auditSubsChange(client, actorTag, t('subs.auditAdd', { name, id: guildId }));
  return name;
}

async function handleSubsText(message, client) {
  if (!isSubsAdminConfigured()) return notConfiguredReply(message);
  if (!isSubsAdminGuild(message.guild?.id)) return;

  const member = await resolveMember(message);
  if (!isSubsAdmin(member)) {
    const inAdminGuild = isSubsAdminGuild(message.guild?.id);
    const hint = inAdminGuild ? t('subs.noPermissionHint') : t('subs.wrongGuild');
    return message.reply(hint).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
  }

  return message.reply(buildListPanel(client)).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
}

async function assignPoolBot(client, guildId, poolId, actorTag) {
  const poolBot = getPoolBot(poolId);
  if (!poolBot) throw new Error('Pool bot not found.');

  const result = await addSlaveBot({ token: poolBot.token, guildId });
  const name = resolveGuildName(client, guildId, subscriptionStore.getGuildFeatures(guildId).label);
  await auditSubsChange(client, actorTag, t('subs.auditBotAdd', {
    name, id: guildId, bot: poolBot.label, slot: result.name,
  }));

  void syncSubscribedSlaves('[SUBS]').catch((err) => logDiscordFailure('SUBS', err, 'panel'));

  const notify = await notifyGuildOwnerBotInvite(guildId, {
    poolBot,
    slotName: result.name,
  });

  return { result, poolBot, notify };
}

async function unassignPoolBot(client, guildId, slaveName, actorTag) {
  const { removed, disconnected } = await removeSlaveBot(slaveName, guildId);
  if (!removed && !disconnected) throw new Error('Bot not found on this server.');
  const name = resolveGuildName(client, guildId, subscriptionStore.getGuildFeatures(guildId).label);
  await auditSubsChange(client, actorTag, t('subs.auditBotRemove', {
    name, id: guildId, slot: slaveName,
  }));
  return { removed, disconnected };
}

function formatBotAddReply({ result, poolBot, notify }) {
  let msg = result.started
    ? t('subs.botAddedStarted', { bot: poolBot.label, slot: result.name })
    : t('subs.botAddedSaved', { bot: poolBot.label, slot: result.name });
  if (result.needsRoom) msg += `\n${t('subs.botAssignRooms')}`;
  if (poolBot.inviteUrl) msg += `\n${t('subs.botInviteLink', { url: poolBot.inviteUrl })}`;
  if (notify?.ok) {
    const parts = [];
    if (notify.dm) parts.push('DM');
    if (notify.channel) parts.push(t('subs.ownerViaMasterChat'));
    msg += `\n${t('subs.ownerNotified', { via: parts.join(' + ') })}`;
  } else {
    msg += `\n${t('subs.ownerNotifyFailed')}`;
  }
  return msg;
}

function wouldPermLockout(member, removeKey) {
  const users = subsAdminStore.listUserIds();
  const roles = subsAdminStore.listRoleIds();
  const roleNames = subsAdminStore.listRoleNames();

  let nextUsers = [...users];
  let nextRoles = [...roles];
  let nextRoleNames = [...roleNames];

  if (removeKey.startsWith('user:')) {
    nextUsers = nextUsers.filter(u => u !== removeKey.slice(5));
  } else if (removeKey.startsWith('role:')) {
    nextRoles = nextRoles.filter(r => r !== removeKey.slice(5));
  } else if (removeKey.startsWith('rolename:')) {
    nextRoleNames = nextRoleNames.filter(r => r !== removeKey.slice(9));
  }

  if (nextUsers.length === 0 && nextRoles.length === 0 && nextRoleNames.length === 0) {
    return true;
  }

  if (!member?.user) return false;

  const uid = member.user.id;
  const stillUser = nextUsers.includes(uid);
  const stillViaRole = nextRoles.some(rid => member.roles.cache.has(rid))
    || nextRoleNames.some(n => member.roles.cache.some(r => r.name.toLowerCase() === n));

  if (!stillUser && !stillViaRole && removeKey === `user:${uid}`) {
    return true;
  }

  if (!stillUser && !stillViaRole && (removeKey.startsWith('role:') || removeKey.startsWith('rolename:'))) {
    const removingOwnRole = removeKey.startsWith('role:')
      && member.roles.cache.has(removeKey.slice(5))
      && !nextRoles.includes(removeKey.slice(5));
    const removingOwnRoleName = removeKey.startsWith('rolename:')
      && member.roles.cache.some(r => r.name.toLowerCase() === removeKey.slice(9))
      && !nextRoleNames.includes(removeKey.slice(9));
    if (removingOwnRole || removingOwnRoleName) return true;
  }

  return false;
}

async function addPermUser(client, actorTag, userId) {
  if (!subsAdminStore.addUser(userId)) return false;
  await auditSubsChange(client, actorTag, t('subs.permAddedUser', { id: userId }));
  return true;
}

async function clearSubsSlashCommands(client) {
  const guildId = getAdminGuildId();
  if (!guildId || !client.application) return;
  try {
    await client.application.commands.set([], guildId);
  } catch (err) {
    console.warn(`[SUBS] Clear slash commands: ${err.message}`);
  }
}

async function handleSubsInteraction(interaction, client) {
  if (!isSubsAdminConfigured()) {
    if (interaction.isRepliable()) return notConfiguredReply(interaction);
    return;
  }
  if (!isSubsAdminGuild(interaction.guild?.id)) return;

  const member = interaction.member ?? await resolveMember(interaction);
  if (!isSubsAdmin(member)) {
    if (interaction.isRepliable()) return denySubs(interaction);
    return;
  }

  if (interaction.isUserSelectMenu()) {
    const parsed = parseSubsId(interaction.customId);
    if (parsed?.action === 'permadduser') {
      const userId = interaction.values[0];
      await deferSubsPanel(interaction);
      await addPermUser(client, interaction.user.tag, userId);
      return editSubsPanel(interaction, await buildPermsPanel(client));
    }
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    const parsed = parseSubsId(interaction.customId);
    if (parsed?.action === 'permaddrole') {
      const roleId = interaction.values[0];
      await deferSubsPanel(interaction);
      if (subsAdminStore.addRole(roleId)) {
        const role = interaction.guild.roles.cache.get(roleId);
        await auditSubsChange(client, interaction.user.tag, t('subs.permAddedRole', {
          id: roleId,
          name: role?.name || roleId,
        }));
      }
      return editSubsPanel(interaction, await buildPermsPanel(client));
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const parsed = parseSubsId(interaction.customId);
    if (parsed?.action === 'permadduser') {
      const userId = interaction.values[0];
      await deferSubsPanel(interaction);
      await addPermUser(client, interaction.user.tag, userId);
      return editSubsPanel(interaction, await buildPermsPanel(client));
    }
    if (parsed?.action === 'permremove') {
      const key = interaction.values[0];
      if (wouldPermLockout(member, key)) {
        return interaction.reply({ content: t('subs.permLockout'), flags: Ephemeral });
      }
      await deferSubsPanel(interaction);
      if (subsAdminStore.removeEntry(key)) {
        await auditSubsChange(client, interaction.user.tag, t('subs.permRemoved', { target: key }));
      }
      return editSubsPanel(interaction, await buildPermsPanel(client));
    }
    if (parsed?.action === 'broadcasttarget') {
      saveDraft(interaction.user.id, { target: interaction.values[0], guildId: null });
      return interaction.update(buildBroadcastPanel(client, interaction.user.id));
    }
    if (parsed?.action === 'broadcastguild') {
      const val = interaction.values[0];
      saveDraft(interaction.user.id, { guildId: val === 'none' ? null : val });
      return interaction.update(buildBroadcastPanel(client, interaction.user.id));
    }
    if (parsed?.action === 'pickbotadd' && parsed.target) {
      const guildId = parsed.target;
      const poolId = interaction.values[0];
      await deferSubsPanel(interaction);
      try {
        const r = await assignPoolBot(client, guildId, poolId, interaction.user.tag);
        return editSubsPanel(interaction, {
          content: formatBotAddReply(r),
          components: [],
        });
      } catch (err) {
        return editSubsPanel(interaction, { content: `❌ ${err.message}`, components: [] }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
      }
    }
    if (parsed?.action === 'pickbotremove' && parsed.target) {
      const guildId = parsed.target;
      const slaveName = interaction.values[0];
      await deferSubsPanel(interaction);
      try {
        await unassignPoolBot(client, guildId, slaveName, interaction.user.tag);
        return editSubsPanel(interaction, {
          content: t('subs.botRemoved', { slot: slaveName }),
          components: [],
        });
      } catch (err) {
        return editSubsPanel(interaction, { content: `❌ ${err.message}`, components: [] }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
      }
    }
    if (parsed?.action === 'features' && parsed.target) {
      const guildId = parsed.target;
      const entry = subscriptionStore.getGuildEntry(guildId);
      if (!entry) {
        return interaction.reply({ content: t('subs.notFound', { id: guildId }), flags: Ephemeral });
      }
      const patch = {};
      for (const field of ['active', 'music', 'bridge', 'slaves', 'editSlaveProfile']) {
        const next = interaction.values.includes(field);
        if (entry[field] !== next) patch[field] = next;
      }
      await deferSubsPanel(interaction);
      if (Object.keys(patch).length) {
        subscriptionStore.mergeGuild(guildId, patch);
        const name = resolveGuildName(client, guildId, entry.label);
        for (const field of Object.keys(patch)) {
          const value = patch[field];
          await auditSubsChange(client, interaction.user.tag, t('subs.auditToggle', {
            name, field, value: value ? t('subs.on') : t('subs.off'),
          }));
        }
      }
      return editSubsPanel(interaction, buildDetailPanel(client, guildId));
    }
    if (interaction.customId === 'subs:select') {
      return interaction.update(buildDetailPanel(client, interaction.values[0]));
    }
    if (interaction.customId === 'subs:pickadd') {
      const guildId = interaction.values[0];
      await deferSubsPanel(interaction);
      const name = await addGuild(client, guildId, { actorTag: interaction.user.tag });
      await editSubsPanel(interaction, buildDetailPanel(client, guildId));
      return interaction.followUp({ content: t('subs.added', { name, id: guildId }), flags: Ephemeral }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const parsed = parseSubsId(interaction.customId);
    if (!parsed) return;

    if (parsed.action === 'modal' && parsed.target === 'add') {
      const guildId = interaction.fields.getTextInputValue('guild_id').trim();
      const label = interaction.fields.getTextInputValue('label')?.trim() || null;
      if (!validGuildId(guildId)) {
        return interaction.reply({ content: t('subs.invalidGuildId'), flags: Ephemeral });
      }
      const name = await addGuild(client, guildId, { label, actorTag: interaction.user.tag });
      await interaction.reply({ content: t('subs.added', { name, id: guildId }), flags: Ephemeral });
      return interaction.followUp(buildDetailPanel(client, guildId)).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
    }

    if (parsed.action === 'modal' && parsed.target === 'broadcast') {
      const message = interaction.fields.getTextInputValue('message').trim();
      if (!message) {
        return interaction.reply({ content: t('subs.broadcastEmpty'), flags: Ephemeral });
      }
      saveDraft(interaction.user.id, { message });
      return interaction.update(buildBroadcastPreviewPanel(client, interaction.user.id));
    }

    const guildId = parsed.extra || parsed.target;
    if (!subscriptionStore.getGuildEntry(guildId) && parsed.target !== 'add' && parsed.target !== 'broadcast') {
      return interaction.reply({ content: t('subs.notFound', { id: guildId }), flags: Ephemeral });
    }

    if (parsed.action === 'modal' && parsed.target === 'expires') {
      const raw = interaction.fields.getTextInputValue('expires');
      const expires = parseExpiresInput(raw);
      if (expires === undefined) {
        return interaction.reply({ content: t('subs.invalidExpires'), flags: Ephemeral });
      }
      await deferSubsPanel(interaction);
      const patch = { expires: expires || null };
      if (expires) patch.lifetime = false;
      subscriptionStore.mergeGuild(guildId, patch);
      await auditSubsChange(client, interaction.user.tag, t('subs.auditExpires', {
        id: guildId, date: expires || t('subs.cleared'),
      }));
      return editSubsPanel(interaction, buildDetailPanel(client, guildId));
    }

    if (parsed.action === 'modal' && parsed.target === 'label') {
      const label = interaction.fields.getTextInputValue('label').trim();
      await deferSubsPanel(interaction);
      // Empty label = back to the live server name (unlocked).
      subscriptionStore.mergeGuild(guildId, label ? { label, labelLocked: true } : { labelLocked: false });
      await auditSubsChange(client, interaction.user.tag, t('subs.auditSet', {
        name: label, field: 'label', value: label,
      }));
      return editSubsPanel(interaction, buildDetailPanel(client, guildId));
    }

    if (parsed.action === 'modal' && parsed.target === 'note') {
      const note = interaction.fields.getTextInputValue('note').trim();
      await deferSubsPanel(interaction);
      subscriptionStore.mergeGuild(guildId, { note: note || null });
      await auditSubsChange(client, interaction.user.tag, t('subs.auditSet', {
        name: resolveGuildName(client, guildId, null), field: 'note', value: note || t('subs.cleared'),
      }));
      return editSubsPanel(interaction, buildDetailPanel(client, guildId));
    }

    if (parsed.action === 'modal' && parsed.target === 'maxslaves') {
      const n = parseInt(interaction.fields.getTextInputValue('maxslaves'), 10);
      if (!Number.isFinite(n) || n < 0 || n > 20) {
        return interaction.reply({ content: t('subs.invalidMaxSlaves'), flags: Ephemeral });
      }
      await deferSubsPanel(interaction);
      subscriptionStore.mergeGuild(guildId, { maxSlaves: n });
      await auditSubsChange(client, interaction.user.tag, t('subs.auditSet', {
        name: resolveGuildName(client, guildId, null), field: 'maxSlaves', value: n,
      }));
      return editSubsPanel(interaction, buildDetailPanel(client, guildId));
    }
    return;
  }

  if (!interaction.isButton()) return;
  const parsed = parseSubsId(interaction.customId);
  if (!parsed) return;

  if (parsed.action === 'filter') {
    return interaction.update(buildListPanel(client, 0, parsed.target || 'all'));
  }
  if (parsed.action === 'page' && parsed.target != null) {
    const page = parseInt(parsed.target, 10) || 0;
    const filter = parsed.extra || 'all';
    return interaction.update(buildListPanel(client, page, filter));
  }
  if (parsed.action === 'refresh' && parsed.target === 'list') {
    const page = parseInt(parsed.extra, 10) || 0;
    const filter = parsed.part4 || 'all';
    return interaction.update(buildListPanel(client, page, filter));
  }
  if (parsed.action === 'back') {
    return interaction.update(buildListPanel(client));
  }
  if (parsed.action === 'help') {
    return interaction.update(buildHelpPanel());
  }
  if (parsed.action === 'perms') {
    return interaction.update(await buildPermsPanel(client));
  }
  if (parsed.action === 'broadcast') {
    return interaction.update(buildBroadcastPanel(client, interaction.user.id));
  }
  if (parsed.action === 'broadcastcompose') {
    return interaction.showModal(buildBroadcastModal());
  }
  if (parsed.action === 'broadcastpreview') {
    const draft = getDraft(interaction.user.id);
    if (!draft.message?.trim()) {
      return interaction.reply({ content: t('subs.broadcastEmpty'), flags: Ephemeral });
    }
    return interaction.update(buildBroadcastPreviewPanel(client, interaction.user.id));
  }
  if (parsed.action === 'broadcastcancel') {
    clearDraft(interaction.user.id);
    return interaction.update(buildListPanel(client));
  }
  if (parsed.action === 'broadcastsend') {
    const draft = getDraft(interaction.user.id);
    if (!draft.message?.trim()) {
      return interaction.reply({ content: t('subs.broadcastEmpty'), flags: Ephemeral });
    }
    const total = countRecipients(client, draft);
    if (total === 0) {
      return interaction.reply({ content: t('subs.broadcastNoTargets'), flags: Ephemeral });
    }
    if (broadcastBusy()) {
      return interaction.reply({ content: t('subs.broadcastBusy'), flags: Ephemeral });
    }
    await deferSubsPanel(interaction);
    const results = await runBroadcast(client, draft, { by: interaction.user.tag });
    await auditSubsChange(client, interaction.user.tag, t('subs.broadcastAudit', {
      ok: results.ok,
      fail: results.fail,
      target: targetLabel(client, draft),
    }));
    clearDraft(interaction.user.id);
    await editSubsPanel(interaction, buildListPanel(client));
    return interaction.followUp({
      embeds: [buildBroadcastResultEmbed(client, draft, results)],
      flags: Ephemeral,
    }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
  }
  if (parsed.action === 'add' && parsed.target === 'manual') {
    return interaction.showModal(buildAddModal());
  }
  if (parsed.action === 'add') {
    return interaction.update(buildAddPickPanel(client));
  }
  if (parsed.action === 'detail' && parsed.target) {
    if (!subscriptionStore.getGuildEntry(parsed.target)) {
      return interaction.reply({ content: t('subs.notFound', { id: parsed.target }), flags: Ephemeral });
    }
    return interaction.update(buildDetailPanel(client, parsed.target));
  }
  if (parsed.action === 'botadd' && parsed.target) {
    const guildId = parsed.target;
    const options = poolAddOptions(guildId);
    if (!options.length) {
      return interaction.reply({ content: t('subs.botAddEmpty'), flags: Ephemeral });
    }
    return interaction.reply({
      content: t('subs.pickBotAdd'),
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`subs:pickbotadd:${guildId}`)
            .setPlaceholder(t('subs.pickBotAddPh'))
            .addOptions(options),
        ),
      ],
      flags: Ephemeral,
    });
  }
  if (parsed.action === 'botremove' && parsed.target) {
    const guildId = parsed.target;
    const options = assignedRemoveOptions(guildId);
    if (!options.length) {
      return interaction.reply({ content: t('subs.botRemoveEmpty'), flags: Ephemeral });
    }
    return interaction.reply({
      content: t('subs.pickBotRemove'),
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`subs:pickbotremove:${guildId}`)
            .setPlaceholder(t('subs.pickBotRemovePh'))
            .addOptions(options),
        ),
      ],
      flags: Ephemeral,
    });
  }
  if (parsed.action === 'expires' && parsed.target) {
    return interaction.showModal(buildExpiresModal(parsed.target));
  }
  if (parsed.action === 'edit' && parsed.target && parsed.extra === 'label') {
    return interaction.showModal(buildLabelModal(parsed.target));
  }
  if (parsed.action === 'edit' && parsed.target && parsed.extra === 'note') {
    return interaction.showModal(buildNoteModal(parsed.target));
  }
  if (parsed.action === 'synclabel' && parsed.target) {
    await deferSubsPanel(interaction);
    const guild = client.guilds.cache.get(parsed.target)
      ?? await client.guilds.fetch(parsed.target).catch(() => null);
    if (!guild) {
      return editSubsPanel(interaction, { content: t('subs.botNotInGuild'), components: [] }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
    }
    subscriptionStore.syncGuildLabel(guild);
    return editSubsPanel(interaction, buildDetailPanel(client, parsed.target));
  }
  if (parsed.action === 'slaves' && parsed.target) {
    const entry = subscriptionStore.getGuildEntry(parsed.target);
    if (!entry) {
      return interaction.reply({ content: t('subs.notFound', { id: parsed.target }), flags: Ephemeral });
    }
    if (parsed.extra === 'set') {
      return interaction.showModal(buildMaxSlavesModal(parsed.target));
    }
    return;
  }
  if (parsed.action === 'remove' && parsed.target && parsed.extra === 'yes') {
    await deferSubsPanel(interaction);
    const name = resolveGuildName(client, parsed.target, subscriptionStore.getGuildFeatures(parsed.target).label);
    subscriptionStore.removeGuild(parsed.target);
    await auditSubsChange(client, interaction.user.tag, t('subs.auditRemove', { name, id: parsed.target }));
    await editSubsPanel(interaction, buildListPanel(client));
    return interaction.followUp({ content: t('subs.removed', { name, id: parsed.target }), flags: Ephemeral }).catch((err) => logDiscordFailure('SUBS', err, 'panel'));
  }
  if (parsed.action === 'remove' && parsed.target) {
    return interaction.update(buildRemoveConfirmPanel(client, parsed.target));
  }
  if (parsed.action === 'extend' && parsed.target) {
    const guildId = parsed.target;
    const days = Number(parsed.extra);
    if (days !== 7 && days !== 30 && days !== 365) return interaction.deferUpdate().catch(() => {});
    const entry = subscriptionStore.getGuildEntry(guildId);
    if (!entry) {
      return interaction.reply({ content: t('subs.notFound', { id: guildId }), flags: Ephemeral });
    }
    const expires = extendExpires(entry.expires, days);
    await deferSubsPanel(interaction);
    subscriptionStore.mergeGuild(guildId, { expires, lifetime: false });
    await auditSubsChange(client, interaction.user.tag, t('subs.auditExpires', {
      id: guildId, date: expires.slice(0, 10),
    }));
    return editSubsPanel(interaction, buildDetailPanel(client, guildId));
  }
  if (parsed.action === 'toggle' && parsed.target && parsed.extra) {
    const guildId = parsed.target;
    const field = parsed.extra;
    if (!TOGGLE_FIELDS.has(field)) return;
    const entry = subscriptionStore.getGuildEntry(guildId);
    if (!entry) {
      return interaction.reply({ content: t('subs.notFound', { id: guildId }), flags: Ephemeral });
    }
    const next = !entry[field];
    const patch = { [field]: next };
    if (field === 'lifetime' && next) patch.expires = null;
    if (field === 'lifetime' && !next && !entry.expires) patch.expires = null;
    await deferSubsPanel(interaction);
    subscriptionStore.mergeGuild(guildId, patch);
    const name = resolveGuildName(client, guildId, entry.label);
    await auditSubsChange(client, interaction.user.tag, t('subs.auditToggle', {
      name, field, value: next ? t('subs.on') : t('subs.off'),
    }));
    return editSubsPanel(interaction, buildDetailPanel(client, guildId));
  }
}

function attachSubsCommands(client) {
  if (client._subsHandlersAttached) return;
  client._subsHandlersAttached = true;

  // T65: the admin server can be picked later in the dashboard, so handlers are always attached
  // and check the current admin server on every message.
  if (isSubsAdminConfigured()) console.log(`[SUBS] Admin subscription panel enabled (guild ${getAdminGuildId()})`);
  else console.log('[SUBS] No admin server yet — pick one in the dashboard (Security)');
  clearSubsSlashCommands(client).catch(err => {
    console.warn(`[SUBS] Clear slash: ${err.message}`);
  });

  client.on('messageCreate', safeListener('[SUBS]', async (message) => {
    if (message.author.bot || !message.guild) return;
    const lower = message.content.trim().toLowerCase();
    if (!isSubsCommand(lower)) return;
    if (!isSubsAdminConfigured()) return;

    const lang = detectSubsLang(lower) ?? localeStore.resolveFromMessage(message);
    return runWithLocale(lang, () => handleSubsText(message, client));
  }));

  client.on('interactionCreate', safeListener('[SUBS]', async (interaction) => {
    if (!interaction.guild) return;
    const id = interaction.customId ?? '';
    if (!id.startsWith('subs:')) return;

    const lang = localeStore.resolveFromInteraction(interaction);
    return runWithLocale(lang, () => handleSubsInteraction(interaction, client));
  }));
}

module.exports = { attachSubsCommands };
