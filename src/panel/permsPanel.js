// permsPanel.js – control panel "Permissions" view: the same per-server member settings as the dashboard (web/guildPerms.js).
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const guildPerms = require('../web/guildPerms');
const { t } = require('../i18n/context');

const TOGGLES = [
  ['listenerCanAdd', '➕'],
  ['listenerVoteSkip', '🗳️'],
  ['allowLinks', '🔗'],
];
const EXTRA_TOGGLES = [
  ['listenerCanPause', '⏯️'],
  ['listenerCanVolume', '🔊'],
  ['pauseWhenEmpty', '⏸️'],
];
const LIMITS_MODAL = 'bridge:permlimits:modal';

function dashboardUrl(guildId) {
  const base = String(process.env.WEB_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(base)) return null;
  return guildId ? `${base}/#/server/${guildId}` : `${base}/#/`;
}

/** Link button to the dashboard page of this server (null when WEB_PUBLIC_URL is not https). */
function dashboardLinkButton(guildId) {
  const url = dashboardUrl(guildId);
  if (!url) return null;
  return new ButtonBuilder().setLabel(t('perm.dashboard')).setStyle(ButtonStyle.Link).setURL(url).setEmoji('🌐');
}

function mentionList(ids, kind) {
  if (!ids.length) return null;
  return ids.slice(0, 20).map(id => (kind === 'role' ? `<@&${id}>` : `<@${id}>`)).join(' ') + (ids.length > 20 ? ` +${ids.length - 20}` : '');
}

function buildPermsEmbed(guild) {
  const p = guildPerms.get(guild.id);
  const on = (v) => (v ? '✅' : '❌');
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🔐 ${t('perm.title')}`)
    .setDescription(t('perm.levels'))
    .addFields(
      { name: `🎧 ${t('perm.djRoles')}`, value: mentionList(p.djRoleIds, 'role') || t('perm.djRolesNone'), inline: false },
      { name: `⭐ ${t('perm.djUsers')}`, value: mentionList(p.djUserIds, 'user') || '—', inline: true },
      { name: `⛔ ${t('perm.banned')}`, value: mentionList(p.bannedUserIds, 'user') || '—', inline: true },
      {
        name: `👂 ${t('perm.listeners')}`,
        value: [
          `${on(p.listenerCanAdd)} ${t('perm.listenerCanAdd')}`,
          `${on(p.listenerVoteSkip)} ${t('perm.listenerVoteSkip')}`,
          `${on(p.listenerCanPause)} ${t('perm.listenerCanPause')}`,
          `${on(p.listenerCanVolume)} ${t('perm.listenerCanVolume')}`,
          `${on(p.allowLinks)} ${t('perm.allowLinks')}`,
          `${on(p.pauseWhenEmpty)} ${t('perm.pauseWhenEmpty')}`,
          `🎵 ${t('perm.playPerMin', { n: p.playPerMin })}`,
          `⏱️ ${p.maxTrackMin ? t('perm.maxTrackMin', { n: p.maxTrackMin }) : t('perm.maxTrackNone')}`,
          `📋 ${p.maxQueuedPerMember ? t('perm.maxQueued', { n: p.maxQueuedPerMember }) : t('perm.maxQueuedNone')}`,
          `🔊 ${t('perm.listenerMaxVolume', { n: p.listenerMaxVolume })}`,
          `${p.djOnly ? '🔒' : '🔓'} ${p.djOnly ? t('perm.djOnlyOn') : t('perm.djOnlyOff')}`,
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: t('perm.footer') });
}

function buildPermsRows(guild) {
  const p = guildPerms.get(guild.id);
  const djRoles = new RoleSelectMenuBuilder()
    .setCustomId('bridge:permset:dj')
    .setPlaceholder(t('perm.pickDjRoles'))
    .setMinValues(0)
    .setMaxValues(guildPerms.LIMITS.djRoleIds);
  if (p.djRoleIds.length) djRoles.setDefaultRoles(...p.djRoleIds);
  const banned = new UserSelectMenuBuilder()
    .setCustomId('bridge:permset:ban')
    .setPlaceholder(t('perm.pickBanned'))
    .setMinValues(0)
    .setMaxValues(25);
  if (p.bannedUserIds.length) banned.setDefaultUsers(...p.bannedUserIds.slice(0, 25));
  const toggles = new ActionRowBuilder().addComponents(
    ...TOGGLES.map(([key, emoji]) => new ButtonBuilder()
      .setCustomId(`bridge:permtoggle:${key}`)
      .setLabel(t(`perm.${key}`).slice(0, 80))
      .setEmoji(emoji)
      .setStyle(p[key] ? ButtonStyle.Success : ButtonStyle.Secondary)),
    new ButtonBuilder().setCustomId('bridge:permlimits').setLabel(t('perm.limitsBtn')).setEmoji('⚙️').setStyle(ButtonStyle.Primary),
  );
  const link = dashboardLinkButton(guild.id);
  if (link) toggles.addComponents(link);
  // T69: "DJ only" on its own row (a row holds 5 buttons and the toggles row is full).
  const djOnly = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bridge:permtoggle:djOnly')
      .setLabel(t('perm.djOnly').slice(0, 80))
      .setEmoji('🔒')
      .setStyle(p.djOnly ? ButtonStyle.Danger : ButtonStyle.Secondary),
    // T71: listener pause / volume
    ...EXTRA_TOGGLES.map(([key, emoji]) => new ButtonBuilder()
      .setCustomId(`bridge:permtoggle:${key}`)
      .setLabel(t(`perm.${key}`).slice(0, 80))
      .setEmoji(emoji)
      .setStyle(p[key] ? ButtonStyle.Success : ButtonStyle.Secondary)),
  );
  return [
    new ActionRowBuilder().addComponents(djRoles),
    new ActionRowBuilder().addComponents(banned),
    toggles,
    djOnly,
  ];
}

function buildLimitsModal(guild) {
  const p = guildPerms.get(guild.id);
  return new ModalBuilder()
    .setCustomId(LIMITS_MODAL)
    .setTitle(t('perm.limitsBtn'))
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('playPerMin').setLabel(t('perm.playPerMinLabel')).setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(2).setValue(String(p.playPerMin))),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('maxTrackMin').setLabel(t('perm.maxTrackMinLabel')).setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(3).setValue(String(p.maxTrackMin))),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('maxQueuedPerMember').setLabel(t('perm.maxQueuedLabel')).setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(3).setValue(String(p.maxQueuedPerMember))),
      new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('listenerMaxVolume').setLabel(t('perm.listenerMaxVolumeLabel')).setStyle(TextInputStyle.Short)
        .setRequired(true).setMaxLength(3).setValue(String(p.listenerMaxVolume))),
    );
}

/** Returns a patch for a perms interaction, or null when the customId is not ours. */
function patchFromInteraction(interaction) {
  const id = interaction.customId || '';
  const gid = interaction.guild?.id;
  if (!gid) return null;
  if (id === 'bridge:permset:dj') return { djRoleIds: interaction.values || [] };
  if (id === 'bridge:permset:ban') return { bannedUserIds: interaction.values || [] };
  const m = /^bridge:permtoggle:(\w+)$/.exec(id);
  if (m && ([...TOGGLES, ...EXTRA_TOGGLES].some(([k]) => k === m[1]) || m[1] === 'djOnly')) return { [m[1]]: !guildPerms.get(gid)[m[1]] };
  if (id === LIMITS_MODAL) {
    const num = (k) => parseInt(interaction.fields.getTextInputValue(k), 10);
    return { playPerMin: num('playPerMin'), maxTrackMin: num('maxTrackMin'), maxQueuedPerMember: num('maxQueuedPerMember'), listenerMaxVolume: num('listenerMaxVolume') };
  }
  return null;
}

/**
 * Handles every perms interaction (buttons, selects, modal). Returns true when handled.
 * buildPanel is injected to avoid a require cycle with controlUI.
 */
async function handlePermsInteraction(interaction, buildPanel) {
  const id = interaction.customId || '';
  if (id === 'bridge:permlimits' && interaction.isButton()) {
    await interaction.showModal(buildLimitsModal(interaction.guild));
    return true;
  }
  const patch = patchFromInteraction(interaction);
  if (!patch) return false;
  guildPerms.set(interaction.guild.id, patch);
  console.log(`[PANEL] perms ${Object.keys(patch).join(',')} set in ${interaction.guild.id} by ${interaction.user?.id}`);
  const payload = buildPanel('perms', interaction.guild);
  if (interaction.isModalSubmit() && !interaction.message) {
    await interaction.reply({ content: t('perm.saved'), flags: 64 });
    return true;
  }
  await interaction.update(payload);
  return true;
}

module.exports = { buildPermsEmbed, buildPermsRows, handlePermsInteraction, dashboardLinkButton, dashboardUrl, patchFromInteraction, LIMITS_MODAL };
