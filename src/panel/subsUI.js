const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const subscriptionStore = require('../subscription/subscriptionStore');
const subsAdminStore = require('../subscription/subsAdminStore');
const { getAdminGuildId } = require('../subscription/adminConfig');
const botStore = require('./botStore');
const { listPoolBots, labelForToken } = require('../config/slavePoolStore');
const { t } = require('../i18n/context');
const { dashboardLinkButton } = require('./permsPanel');
const { getDraft, countRecipients, targetLabel } = require('./subsBroadcast');
const {
  guildMembersIntentEnabled,
  formatPermUserLine,
  buildPermAddUserOptions,
  searchPermMembers,
  autocompleteChoiceLabel,
} = require('../subscription/subsPermResolve');

const BROADCAST_LIST_MAX = 20;
const FIELD_MAX = 1024;

function formatBotKey(botKey) {
  if (!botKey || botKey === 'master') return t('subs.broadcastBotMaster');
  return t('subs.broadcastBotSlave', { slot: botKey });
}

function formatBroadcastFailReason(reason) {
  const key = `subs.broadcastFailReason.${reason}`;
  const translated = t(key);
  return translated !== key ? translated : reason;
}

function truncateField(text, max = FIELD_MAX) {
  const s = String(text || '');
  if (s.length <= max) return s || '—';
  return `${s.slice(0, max - 1)}…`;
}

function formatBroadcastList(lines, maxLines = BROADCAST_LIST_MAX) {
  if (!lines.length) return t('subs.broadcastResultNone');
  if (lines.length <= maxLines) return truncateField(lines.join('\n'));
  const shown = lines.slice(0, maxLines);
  return truncateField(
    `${shown.join('\n')}\n${t('subs.broadcastResultMore', { count: lines.length - maxLines })}`,
  );
}

function buildBroadcastResultEmbed(client, draft, results) {
  const isOwners = draft.target === 'owners';
  const deliveredLines = results.delivered.map((r) => {
    if (isOwners) {
      return t('subs.broadcastResultLineOwner', {
        guild: r.guildName,
        owner: r.ownerTag ? `${r.ownerTag} (\`${r.ownerId}\`)` : `\`${r.guildId}\``,
      });
    }
    return t('subs.broadcastResultLineChannel', {
      guild: r.guildName,
      channel: r.channelName || r.channelId,
      bot: formatBotKey(r.botKey),
    });
  });

  const failedLines = results.failures.map((r) => {
    const reason = formatBroadcastFailReason(r.reason);
    if (isOwners) {
      return t('subs.broadcastResultLineFailOwner', {
        guild: r.guildName,
        owner: r.ownerTag ? `${r.ownerTag} (\`${r.ownerId}\`)` : '',
        reason,
      });
    }
    return t('subs.broadcastResultLineFailChannel', {
      guild: r.guildName,
      channel: r.channelName || r.channelId || '—',
      bot: formatBotKey(r.botKey),
      reason,
    });
  });

  const embed = new EmbedBuilder()
    .setTitle(t('subs.broadcastResultTitle'))
    .setColor(results.fail ? 0xfaa61a : 0x57f287)
    .addFields(
      { name: t('subs.broadcastFieldTarget'), value: targetLabel(client, draft), inline: true },
      {
        name: t('subs.broadcastResultSummary'),
        value: t('subs.broadcastDone', {
          ok: results.ok,
          fail: results.fail,
          total: results.total,
        }),
        inline: true,
      },
      {
        name: t('subs.broadcastFieldMessage'),
        value: truncateField(results.message || draft.message, 1024),
        inline: false,
      },
      {
        name: t('subs.broadcastResultDelivered', { count: results.delivered.length }),
        value: formatBroadcastList(deliveredLines),
        inline: false,
      },
    );

  if (failedLines.length) {
    embed.addFields({
      name: t('subs.broadcastResultFailed', { count: results.failures.length }),
      value: formatBroadcastList(failedLines),
      inline: false,
    });
  }

  return embed;
}

const SELECT_MAX = 25;
/** One page size for the list embed and its select menu (they must show the same servers). */
const LIST_PAGE = 20;

function subsCid(...parts) {
  return ['subs', ...parts.map(p => String(p ?? ''))].filter((p, i) => i === 0 || p !== '').join(':');
}

function parseSubsId(customId) {
  const parts = String(customId).split(':');
  if (parts[0] !== 'subs' || parts.length < 2) return null;
  return {
    action: parts[1],
    target: parts[2] ?? null,
    extra: parts[3] ?? null,
    part4: parts[4] ?? null,
  };
}

function boolLabel(on) {
  return on ? t('subs.on') : t('subs.off');
}

function planLabel(f) {
  if (f.lifetime) return t('subs.planLifetime');
  if (f.expires) return t('subs.planUntil', { date: f.expires });
  if (!f.lifetime && !f.expires) return t('subs.planTimedOff');
  return t('subs.planTimed');
}

function resolveGuildName(client, guildId, label) {
  const g = client?.guilds?.cache?.get(guildId);
  return g?.name || label || guildId;
}

function listSummaries() {
  return subscriptionStore.listAllSummaries();
}

/** Whole days until a subscription's `expires` date (null for lifetime / no date). */
function subDaysLeft(s) {
  if (s.lifetime || !s.expires) return null;
  const ms = Date.parse(s.expires);
  return Number.isFinite(ms) ? Math.ceil((ms - Date.now()) / 86_400_000) : null;
}

/** Active, not lifetime, ends within 7 days. */
function isExpiringSoon(s) {
  const d = subDaysLeft(s);
  return Boolean(s.allowed) && d != null && d >= 0 && d <= 7;
}

const LIST_FILTERS = [
  { key: 'all', emoji: '📋', labelKey: 'subs.filterAll' },
  { key: 'active', emoji: '✅', labelKey: 'subs.filterActive' },
  { key: 'soon', emoji: '⚠️', labelKey: 'subs.filterSoon' },
  { key: 'expired', emoji: '⏱️', labelKey: 'subs.filterExpired' },
  { key: 'away', emoji: '🚪', labelKey: 'subs.filterAway' },
];

function filterLabel(filter) {
  const f = LIST_FILTERS.find(x => x.key === filter) || LIST_FILTERS[0];
  return t(f.labelKey);
}

/** Rows matching a list filter; unknown filter names fall back to `all`. */
function filterSummaries(client, rows, filter) {
  switch (filter) {
    case 'active':
      return rows.filter(r => r.allowed);
    case 'soon':
      return rows.filter(r => {
        const d = subDaysLeft(r);
        return Boolean(r.allowed) && !r.lifetime && d != null && d >= 0 && d <= 7;
      });
    case 'expired':
      return rows.filter(r => !r.allowed);
    case 'away':
      return rows.filter(r => Boolean(client) && client.guilds && client.guilds.cache && !client.guilds.cache.has(r.guildId));
    default:
      return rows;
  }
}

function formatSummaryLine(client, s) {
  const name = resolveGuildName(client, s.guildId, s.label);
  const st = s.allowed ? '✅' : (s.expired ? '⏱️' : (s.active === false ? '⛔' : '❌'));
  const d = subDaysLeft(s);
  let plan = '';
  if (s.allowed && s.lifetime) plan = ' · ♾️';
  else if (s.allowed && d != null) plan = d <= 7 ? ` · ⚠️ **${t('subs.daysShort', { n: d })}**` : ` · ⏳ ${t('subs.daysShort', { n: d })}`;
  else if (!s.allowed && s.expired && s.expires) plan = ` · ${t('subs.endedOn', { date: String(s.expires).slice(0, 10) })}`;
  else if (!s.allowed && s.active === false) plan = ` · ${t('subs.turnedOff')}`;
  // Subscribed but the bot is not in that server (kicked / never invited).
  const away = client?.guilds?.cache && !client.guilds.cache.has(s.guildId) ? ` · ${t('subs.botNotIn')}` : '';
  return `${st} **${name}** \`${s.guildId}\`${plan}${away}`;
}

function buildStatsBlock(rows) {
  const active = rows.filter(r => r.allowed).length;
  const expired = rows.filter(r => r.expired).length;
  const off = rows.filter(r => r.active === false).length;
  const soon = rows.filter(isExpiringSoon).length;
  const line = t('subs.stats', { total: rows.length, active, expired, off });
  return soon ? `${line}\n${t('subs.expiringSoon', { n: soon })}` : line;
}

function buildListEmbed(client, page = 0, filter = 'all') {
  const rows = filterSummaries(client, listSummaries(), filter);
  const header = `${t('subs.listDesc', { total: rows.length, active: rows.filter(r => r.allowed).length })}\n${buildStatsBlock(rows)}`;
  const embed = new EmbedBuilder()
    .setTitle(t('subs.title'))
    .setDescription(header)
    .setColor(0x5865f2);

  if (!rows.length) {
    if (filter === 'all') {
      embed.addFields({ name: t('subs.empty'), value: t('subs.emptyHint') });
    } else {
      embed.addFields({ name: t('subs.filterLabel', { name: filterLabel(filter) }), value: t('subs.filterEmpty') });
    }
    return embed;
  }

  const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE));
  const p = Math.min(Math.max(0, parseInt(page, 10) || 0), pages - 1);
  const lines = rows.slice(p * LIST_PAGE, (p + 1) * LIST_PAGE).map(s => formatSummaryLine(client, s));
  // Description (4096) instead of a field (1024): 20 long server names overflow a field.
  embed.setDescription(`${t('subs.filterLabel', { name: filterLabel(filter) })}\n${header}\n\n**${t('subs.servers')}**\n${lines.join('\n')}`.slice(0, 4096));
  if (pages > 1) embed.setFooter({ text: t('subs.pageFooter', { page: p + 1, pages }) });
  return embed;
}

function buildListComponents(client, page = 0, filter = 'all') {
  const allRows = listSummaries();
  const rows = filterSummaries(client, allRows, filter);
  const components = [];
  const menuSlice = rows.slice(page * LIST_PAGE, (page + 1) * LIST_PAGE);

  if (menuSlice.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(subsCid('select'))
      .setPlaceholder(t('subs.pickServer'))
      .addOptions(
        menuSlice.map(s => {
          const name = resolveGuildName(client, s.guildId, s.label);
          const st = s.allowed ? '✅' : '❌';
          const d = subDaysLeft(s);
          const plan = s.lifetime ? '♾️' : (d != null ? (d >= 0 ? t('subs.daysShort', { n: d }) : t('subs.endedOn', { date: String(s.expires).slice(0, 10) })) : '');
          return new StringSelectMenuOptionBuilder()
            .setLabel(name.slice(0, 100))
            .setDescription([st, plan, s.guildId].filter(Boolean).join(' · ').slice(0, 100))
            .setValue(s.guildId);
        }),
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  // Filter buttons with per-filter counts (5 fit on one row).
  components.push(new ActionRowBuilder().addComponents(
    ...LIST_FILTERS.map(f => {
      const count = filterSummaries(client, allRows, f.key).length;
      return new ButtonBuilder()
        .setCustomId(subsCid('filter', f.key))
        .setLabel(`${t(f.labelKey)} (${count})`)
        .setEmoji(f.emoji)
        .setStyle(f.key === filter ? ButtonStyle.Primary : ButtonStyle.Secondary);
    }),
  ));

  // Nav row: prev/next are added only when they exist, so Help is never sliced off.
  const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE));
  const nav = [];
  if (page > 0) {
    nav.push(new ButtonBuilder().setCustomId(subsCid('page', page - 1, filter)).setLabel('◀').setStyle(ButtonStyle.Secondary));
  }
  if (page < pages - 1) {
    nav.push(new ButtonBuilder().setCustomId(subsCid('page', page + 1, filter)).setLabel('▶').setStyle(ButtonStyle.Secondary));
  }
  nav.push(new ButtonBuilder().setCustomId(subsCid('refresh', 'list', page, filter)).setLabel(t('subs.refresh')).setEmoji('🔄').setStyle(ButtonStyle.Secondary));
  const dash = dashboardLinkButton(null);
  if (dash) nav.push(dash);
  components.push(new ActionRowBuilder().addComponents(...nav));
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(subsCid('add')).setLabel(t('subs.add')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(subsCid('perms')).setLabel(t('subs.permsBtn')).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(subsCid('broadcast')).setLabel(t('subs.broadcastBtn')).setEmoji('📢').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(subsCid('help')).setLabel(t('subs.helpBtn')).setStyle(ButtonStyle.Primary),
  ));
  return components;
}

function buildListPanel(client, page = 0, filter = 'all') {
  // Clamp once so embed, select and nav buttons always describe the same page (servers can be removed).
  const pages = Math.max(1, Math.ceil(filterSummaries(client, listSummaries(), filter).length / LIST_PAGE));
  page = Math.min(Math.max(0, parseInt(page, 10) || 0), pages - 1);
  return {
    embeds: [buildListEmbed(client, page, filter)],
    components: buildListComponents(client, page, filter),
  };
}

function formatAssignedBots(guildId) {
  const assigned = botStore.listSlaves(guildId);
  if (!assigned.length) return t('subs.assignedBotsNone');
  return assigned.map(s => {
    const label = labelForToken(s.token);
    return label ? `**#${s.name}** · ${label}` : `**#${s.name}** ${t('common.privateTag')}`;
  }).join('\n').slice(0, 1024);
}

function poolAddOptions(guildId) {
  const assignedTokens = new Set(botStore.listSlaves(guildId).map(s => s.token));
  return listPoolBots()
    .filter(b => !assignedTokens.has(b.token))
    .slice(0, SELECT_MAX)
    .map(b => new StringSelectMenuOptionBuilder()
      .setLabel(b.label.slice(0, 100))
      .setDescription(b.clientId ? `ID ${b.clientId}`.slice(0, 100) : `#${b.id}`)
      .setValue(b.id));
}

function assignedRemoveOptions(guildId) {
  return botStore.listSlaves(guildId)
    .slice(0, SELECT_MAX)
    .map(s => {
      const label = labelForToken(s.token);
      return new StringSelectMenuOptionBuilder()
        .setLabel((label || `${t('common.slave')} #${s.name}`).slice(0, 100))
        .setDescription(`#${s.name}`.slice(0, 100))
        .setValue(s.name);
    });
}

function buildBotManageRow(guildId) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  if (!f.slaves) return null;
  const assigned = botStore.listSlaves(guildId);
  const canAdd = assigned.length < f.maxSlaves && poolAddOptions(guildId).length > 0;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(subsCid('botadd', guildId))
      .setLabel(t('subs.addBot'))
      .setStyle(ButtonStyle.Success)
      .setEmoji('➕')
      .setDisabled(!canAdd),
    new ButtonBuilder()
      .setCustomId(subsCid('botremove', guildId))
      .setLabel(t('subs.removeBot'))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('➖')
      .setDisabled(!assigned.length),
  );
}

function buildDetailEmbed(client, guildId) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  const entry = subscriptionStore.getGuildEntry(guildId);
  const name = resolveGuildName(client, guildId, f.label);
  const g = client.guilds.cache.get(guildId);
  const d = subDaysLeft(f);
  const status = f.allowed
    ? t('subs.statusActive')
    : (f.expired ? t('subs.statusExpired') : (f.active === false ? t('subs.statusOff') : t('subs.statusInactive')));
  let plan = '';
  if (f.lifetime) plan = `♾️ ${t('subs.planLifetime')}`;
  else if (f.expires) plan = t('subs.planUntil', { date: f.expires });
  if (plan && f.allowed && d != null && d >= 1) plan = `${plan} · ${t('subs.daysLeft', { n: d })}`;
  const memberCount = g ? (g.memberCount ?? (g.members?.cache?.size)) : null;
  const idLine = `🆔 \`${guildId}\` · ${g ? '✅' : t('subs.botNotIn')}`
    + (memberCount != null ? ` · 👥 ${memberCount}` : '');
  const slavesLine = f.slaves ? `🤖 ${botStore.listSlaves(guildId).length}/${f.maxSlaves}` : '';
  const locked = Boolean(entry?.labelLocked);
  const featureLine = (on, label) => `${on ? '✅' : '❌'} ${label}`;
  const features = [
    featureLine(Boolean(f.active), t('subs.toggleActive')),
    featureLine(Boolean(f.music), t('subs.toggleMusic')),
    featureLine(Boolean(f.bridge), t('subs.toggleBridge')),
    featureLine(Boolean(f.slaves), t('subs.toggleSlaves')),
    featureLine(Boolean(f.editSlaveProfile), t('subs.toggleEditSlaveProfile')),
    featureLine(locked, t('subs.toggleLabelLock')),
  ].join('\n');
  const desc = [`${status}${plan ? ` · ${plan}` : ''}`, idLine, slavesLine].filter(Boolean).join('\n');

  const color = !f.allowed ? 0xed4245 : (d != null && d <= 7 ? 0xfaa61a : 0x57f287);
  const embed = new EmbedBuilder()
    .setTitle(t('subs.detailTitle', { name }))
    .setDescription(desc)
    .setColor(color)
    .addFields({ name: t('subs.fieldFeatures'), value: features });

  if (entry?.note) {
    embed.addFields({ name: t('subs.fieldNote'), value: entry.note.slice(0, 1024) });
  }
  if (f.slaves) {
    embed.addFields({
      name: t('subs.fieldAssignedBots'),
      value: formatAssignedBots(guildId),
      inline: false,
    });
  }
  return embed;
}

function toggleButton(guildId, field, on) {
  const labels = {
    active: t('subs.toggleActive'),
    music: t('subs.toggleMusic'),
    bridge: t('subs.toggleBridge'),
    slaves: t('subs.toggleSlaves'),
    lifetime: t('subs.toggleLifetime'),
    labelLocked: t('subs.toggleLabelLock'),
    editSlaveProfile: t('subs.toggleEditSlaveProfile'),
  };
  return new ButtonBuilder()
    .setCustomId(subsCid('toggle', guildId, field))
    .setLabel(`${labels[field]}: ${boolLabel(on)}`)
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildDetailPanel(client, guildId) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  const entry = subscriptionStore.getGuildEntry(guildId);
  const locked = Boolean(entry?.labelLocked);
  const select = new StringSelectMenuBuilder()
    .setCustomId(subsCid('features', guildId))
    .setPlaceholder(t('subs.featuresPh'))
    .setMinValues(0)
    .setMaxValues(5);
  for (const [value, emoji, label, on] of [
    ['active', '✅', t('subs.toggleActive'), f.active],
    ['music', '🎵', t('subs.toggleMusic'), f.music],
    ['bridge', '🌉', t('subs.toggleBridge'), f.bridge],
    ['slaves', '🤖', t('subs.toggleSlaves'), f.slaves],
    ['editSlaveProfile', '🎨', t('subs.toggleEditSlaveProfile'), f.editSlaveProfile],
  ]) {
    select.addOptions(new StringSelectMenuOptionBuilder()
      .setValue(value)
      .setEmoji(emoji)
      .setLabel(label)
      .setDefault(Boolean(on)));
  }
  const components = [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(subsCid('extend', guildId, '7'))
        .setLabel(t('subs.extend7'))
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(f.lifetime),
      new ButtonBuilder()
        .setCustomId(subsCid('extend', guildId, '30'))
        .setLabel(t('subs.extend30'))
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(f.lifetime),
      new ButtonBuilder()
        .setCustomId(subsCid('extend', guildId, '365'))
        .setLabel(t('subs.extend365'))
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(f.lifetime),
      toggleButton(guildId, 'lifetime', f.lifetime)
        .setEmoji('♾️'),
      new ButtonBuilder()
        .setCustomId(subsCid('expires', guildId))
        .setLabel(t('subs.setExpires'))
        .setEmoji('📅')
        .setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(subsCid('edit', guildId, 'label'))
        .setLabel(t('subs.editLabel'))
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(subsCid('edit', guildId, 'note'))
        .setLabel(t('subs.editNote'))
        .setEmoji('📝')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(subsCid('synclabel', guildId))
        .setLabel(t('subs.syncLabel'))
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
      toggleButton(guildId, 'labelLocked', locked)
        .setEmoji(locked ? '🔒' : '🔓'),
    ),
  ];
  const botRow = buildBotManageRow(guildId);
  if (botRow) {
    botRow.addComponents(
      new ButtonBuilder()
        .setCustomId(subsCid('slaves', guildId, 'set'))
        .setLabel(t('subs.slavesSet'))
        .setEmoji('🔢')
        .setStyle(ButtonStyle.Secondary),
    );
    components.push(botRow);
  }
  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(subsCid('back'))
        .setLabel(t('subs.back'))
        .setEmoji('⬅️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(subsCid('help'))
        .setLabel(t('subs.helpBtn'))
        .setEmoji('❓')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(subsCid('remove', guildId))
        .setLabel(t('subs.remove'))
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
      ...[dashboardLinkButton(guildId)].filter(Boolean),
    ),
  );
  return {
    embeds: [buildDetailEmbed(client, guildId)],
    components: components.slice(0, 5),
  };
}

function buildHelpPanel() {
  const embed = new EmbedBuilder()
    .setTitle(t('subs.helpTitle'))
    .setDescription(t('subs.helpBody'))
    .setColor(0x5865f2);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(subsCid('back')).setLabel(t('subs.back')).setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function adminGuild(client) {
  const id = getAdminGuildId();
  return id ? client.guilds.cache.get(id) : null;
}

function buildPermRemoveOptions(client) {
  const guild = adminGuild(client);
  const options = [];

  for (const uid of subsAdminStore.listUserIds()) {
    const m = guild?.members.cache.get(uid);
    const label = (m?.displayName || m?.user?.username || uid).slice(0, 100);
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setDescription(t('subs.permRemoveUser').slice(0, 100))
      .setValue(`user:${uid}`));
  }

  for (const rid of subsAdminStore.listRoleIds()) {
    const role = guild?.roles.cache.get(rid);
    const label = (role?.name || rid).slice(0, 100);
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setDescription(t('subs.permRemoveRole').slice(0, 100))
      .setValue(`role:${rid}`));
  }

  for (const name of subsAdminStore.listRoleNames()) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(name.slice(0, 100))
      .setDescription(t('subs.permRemoveRoleName').slice(0, 100))
      .setValue(`rolename:${name}`));
  }

  return options.slice(0, SELECT_MAX);
}

async function buildPermsPanel(client) {
  const guild = adminGuild(client);
  const userIds = subsAdminStore.listUserIds();
  const roleIds = subsAdminStore.listRoleIds();
  const roleNames = subsAdminStore.listRoleNames();

  const userLines = userIds.length
    ? (await Promise.all(userIds.map(id => formatPermUserLine(client, guild, id)))).join('\n')
    : t('subs.permsEmptyUsers');

  const roleLines = roleIds.length
    ? roleIds.map((id) => {
        const role = guild?.roles.cache.get(id);
        return role ? `• <@&${id}> — **${role.name}**` : `• \`${id}\``;
      }).join('\n')
    : t('subs.permsEmptyRoles');

  const roleNameLines = roleNames.length
    ? roleNames.map(n => `• \`${n}\``).join('\n')
    : t('subs.permsEmptyRoleNames');

  const embed = new EmbedBuilder()
    .setTitle(t('subs.permsTitle'))
    .setDescription(t('subs.permsDesc'))
    .setColor(0x5865f2)
    .addFields(
      { name: t('subs.permsUsers', { count: userIds.length }), value: userLines.slice(0, 1024), inline: false },
      { name: t('subs.permsRoles', { count: roleIds.length }), value: roleLines.slice(0, 1024), inline: false },
      { name: t('subs.permsRoleNames', { count: roleNames.length }), value: roleNameLines.slice(0, 1024), inline: false },
    )
    .setFooter({ text: t('subs.permEnvHint') });

  const components = [];
  const { options: addUserOptions, truncated } = guild && guildMembersIntentEnabled()
    ? await buildPermAddUserOptions(guild)
    : { options: [], truncated: false };

  if (addUserOptions.length) {
    if (truncated) {
      embed.setDescription(`${t('subs.permsDesc')}\n${t('subs.permAddUserTruncated')}`);
    }
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(subsCid('permadduser'))
        .setPlaceholder(t('subs.permAddUser'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(addUserOptions.map(o => new StringSelectMenuOptionBuilder()
          .setLabel(o.label)
          .setDescription(o.description)
          .setValue(o.value))),
    ));
  } else if (guildMembersIntentEnabled()) {
    embed.setDescription(`${t('subs.permsDesc')}\n${t('subs.permAddUserEmpty')}`);
  } else {
    embed.setDescription(`${t('subs.permsDesc')}\n${t('subs.permUserNeedIntentShort')}`);
    components.push(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(subsCid('permadduser'))
        .setPlaceholder(t('subs.permAddUserFallback'))
        .setMinValues(1)
        .setMaxValues(1),
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(subsCid('permaddrole'))
      .setPlaceholder(t('subs.permAddRole'))
      .setMinValues(1)
      .setMaxValues(1),
  ));

  const removeOptions = buildPermRemoveOptions(client);
  if (removeOptions.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(subsCid('permremove'))
        .setPlaceholder(t('subs.permRemove'))
        .addOptions(removeOptions),
    ));
  }

  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(subsCid('back')).setLabel(t('subs.back')).setStyle(ButtonStyle.Secondary),
  ));

  return { embeds: [embed], components: components.slice(0, 5) };
}

function buildBroadcastTargetOptions(selected = 'active') {
  const defs = [
    { value: 'active', label: t('subs.broadcastTargetActive'), desc: t('subs.broadcastTargetActiveDesc') },
    { value: 'active_master', label: t('subs.broadcastTargetActiveMaster'), desc: t('subs.broadcastTargetActiveMasterDesc') },
    { value: 'inactive', label: t('subs.broadcastTargetInactive'), desc: t('subs.broadcastTargetInactiveDesc') },
    { value: 'inactive_master', label: t('subs.broadcastTargetInactiveMaster'), desc: t('subs.broadcastTargetInactiveMasterDesc') },
    { value: 'all', label: t('subs.broadcastTargetAll'), desc: t('subs.broadcastTargetAllDesc') },
    { value: 'owners', label: t('subs.broadcastTargetOwners'), desc: t('subs.broadcastTargetOwnersDesc') },
  ];
  return defs.map(d => new StringSelectMenuOptionBuilder()
    .setLabel(d.label)
    .setDescription(d.desc.slice(0, 100))
    .setValue(d.value)
    .setDefault(d.value === selected));
}

function buildBroadcastGuildOptions(client) {
  const rows = listSummaries().slice(0, SELECT_MAX - 1);
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel(t('subs.broadcastNoGuild'))
      .setDescription(t('subs.broadcastNoGuildDesc'))
      .setValue('none'),
  ];
  for (const s of rows) {
    const name = resolveGuildName(client, s.guildId, s.label);
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(name.slice(0, 100))
      .setDescription(s.guildId.slice(0, 100))
      .setValue(s.guildId));
  }
  return options;
}

function buildBroadcastPanel(client, userId) {
  const draft = getDraft(userId);
  const count = countRecipients(client, draft);

  const embed = new EmbedBuilder()
    .setTitle(t('subs.broadcastTitle'))
    .setDescription(t('subs.broadcastDesc'))
    .setColor(0x5865f2)
    .addFields(
      { name: t('subs.broadcastFieldTarget'), value: targetLabel(client, draft), inline: true },
      { name: t('subs.broadcastFieldCount'), value: String(count), inline: true },
    );

  if (draft.message) {
    embed.addFields({
      name: t('subs.broadcastFieldMessage'),
      value: draft.message.slice(0, 1024),
      inline: false,
    });
  }

  const components = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(subsCid('broadcasttarget'))
        .setPlaceholder(t('subs.broadcastPickTarget'))
        .addOptions(buildBroadcastTargetOptions(draft.target)),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(subsCid('broadcastguild'))
        .setPlaceholder(t('subs.broadcastPickGuild'))
        .addOptions(buildBroadcastGuildOptions(client)),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(subsCid('broadcastcompose'))
        .setLabel(t('subs.broadcastCompose'))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️'),
      new ButtonBuilder()
        .setCustomId(subsCid('broadcastpreview'))
        .setLabel(t('subs.broadcastPreview'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!draft.message?.trim()),
      new ButtonBuilder()
        .setCustomId(subsCid('back'))
        .setLabel(t('subs.back'))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  return { embeds: [embed], components: components.slice(0, 5) };
}

function buildBroadcastPreviewPanel(client, userId) {
  const draft = getDraft(userId);
  const count = countRecipients(client, draft);
  const embed = new EmbedBuilder()
    .setTitle(t('subs.broadcastPreviewTitle'))
    .setDescription(draft.message?.slice(0, 4096) || '—')
    .setColor(0xfee75c)
    .addFields(
      { name: t('subs.broadcastFieldTarget'), value: targetLabel(client, draft), inline: true },
      { name: t('subs.broadcastFieldCount'), value: String(count), inline: true },
    )
    .setFooter({ text: t('subs.broadcastPreviewHint') });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(subsCid('broadcastsend'))
          .setLabel(t('subs.broadcastSend'))
          .setStyle(ButtonStyle.Danger)
          .setEmoji('📢'),
        new ButtonBuilder()
          .setCustomId(subsCid('broadcast'))
          .setLabel(t('subs.broadcastEdit'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(subsCid('broadcastcancel'))
          .setLabel(t('subs.cancel'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildBroadcastModal() {
  const modal = new ModalBuilder()
    .setCustomId(subsCid('modal', 'broadcast'))
    .setTitle(t('subs.broadcastModalTitle'));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('message')
        .setLabel(t('subs.broadcastModalMessage'))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2000)
        .setPlaceholder(t('subs.broadcastModalPlaceholder')),
    ),
  );
  return modal;
}

function unsubscribedBotGuilds(client) {
  const subscribed = new Set(subscriptionStore.listAllGuildIds());
  return [...client.guilds.cache.values()]
    .filter(g => !subscribed.has(g.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, SELECT_MAX);
}

function buildAddPickPanel(client) {
  const candidates = unsubscribedBotGuilds(client);
  const embed = new EmbedBuilder()
    .setTitle(t('subs.addPickTitle'))
    .setDescription(candidates.length ? t('subs.addPickDesc') : t('subs.addPickEmpty'))
    .setColor(0x57f287);

  const components = [];
  if (candidates.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(subsCid('pickadd'))
      .setPlaceholder(t('subs.addPickPlaceholder'))
      .addOptions(
        candidates.map(g => new StringSelectMenuOptionBuilder()
          .setLabel(g.name.slice(0, 100))
          .setDescription(g.id)
          .setValue(g.id)),
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(subsCid('add', 'manual')).setLabel(t('subs.addById')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(subsCid('back')).setLabel(t('subs.back')).setStyle(ButtonStyle.Secondary),
  ));
  return { embeds: [embed], components };
}

function buildRemoveConfirmPanel(client, guildId) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  const name = resolveGuildName(client, guildId, f.label);
  const embed = new EmbedBuilder()
    .setTitle(t('subs.removeConfirmTitle'))
    .setDescription(t('subs.removeConfirmDesc', { name, id: guildId }))
    .setColor(0xed4245);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(subsCid('remove', guildId, 'yes'))
          .setLabel(t('subs.removeYes'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(subsCid('detail', guildId))
          .setLabel(t('subs.cancel'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildAddModal() {
  const modal = new ModalBuilder()
    .setCustomId(subsCid('modal', 'add'))
    .setTitle(t('subs.addModalTitle'));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('guild_id')
        .setLabel(t('subs.addGuildId'))
        .setPlaceholder('766294211233841204')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(17)
        .setMaxLength(20),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('label')
        .setLabel(t('subs.addLabel'))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80),
    ),
  );
  return modal;
}

function buildExpiresModal(guildId) {
  const entry = subscriptionStore.getGuildEntry(guildId);
  const modal = new ModalBuilder()
    .setCustomId(subsCid('modal', 'expires', guildId))
    .setTitle(t('subs.expiresModalTitle'));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('expires')
        .setLabel(t('subs.expiresInput'))
        .setPlaceholder('2028-12-31 or - to clear')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(entry?.expires ? String(entry.expires) : ''),
    ),
  );
  return modal;
}

function buildLabelModal(guildId) {
  const entry = subscriptionStore.getGuildEntry(guildId);
  const modal = new ModalBuilder()
    .setCustomId(subsCid('modal', 'label', guildId))
    .setTitle(t('subs.labelModalTitle'));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('label')
        .setLabel(t('subs.fieldLabel'))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(entry?.label ? String(entry.label).slice(0, 100) : ''),
    ),
  );
  return modal;
}

function buildNoteModal(guildId) {
  const entry = subscriptionStore.getGuildEntry(guildId);
  const modal = new ModalBuilder()
    .setCustomId(subsCid('modal', 'note', guildId))
    .setTitle(t('subs.noteModalTitle'));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel(t('subs.fieldNote'))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setValue(entry?.note ? String(entry.note).slice(0, 500) : ''),
    ),
  );
  return modal;
}

function buildMaxSlavesModal(guildId) {
  const entry = subscriptionStore.getGuildEntry(guildId);
  const modal = new ModalBuilder()
    .setCustomId(subsCid('modal', 'maxslaves', guildId))
    .setTitle(t('subs.slavesModalTitle'));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('maxslaves')
        .setLabel(t('subs.fieldMaxSlaves'))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2)
        .setValue(String(entry?.maxSlaves ?? 3)),
    ),
  );
  return modal;
}

function extendExpires(currentIso, days, nowMs = Date.now()) {
  const base = Date.parse(currentIso);
  const start = Number.isFinite(base) && base > nowMs ? base : nowMs;
  return new Date(start + days * 86400000).toISOString();
}

module.exports = {
  subsCid,
  parseSubsId,
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
  resolveGuildName,
  listSummaries,
  filterSummaries,
  poolAddOptions,
  assignedRemoveOptions,
  extendExpires,
};
