const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActivityType,
  Routes,
} = require('discord.js');
const profileStore = require('./profileStore');
const { pickPersistPatch } = profileStore;
const { BULK_BOT_KEY } = require('./profileKeys');
const { t } = require('../i18n/context');

const ACTIVITY_MAP = {
  playing: ActivityType.Playing,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  streaming: ActivityType.Streaming,
  custom: ActivityType.Custom,
};

const ACTIVITY_ALIASES = {
  play: 'playing',
  game: 'playing',
  listen: 'listening',
  watch: 'watching',
  compete: 'competing',
  stream: 'streaming',
};

function isActivityTypeKey(key) {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_MAP, key);
}

function activityLabel(key) {
  return t(`profile.act.${key}`) || key;
}

const VALID_STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);

function profileModalId(botKey) {
  return `bridge:profilemodal:${botKey}`;
}

function identityModalId(botKey) {
  return `bridge:identitymodal:${botKey}`;
}

function bannerModalId(botKey) {
  return `bridge:bannermodal:${botKey}`;
}

function presenceHubModalId(botKey) {
  return `bridge:presencehubmodal:${botKey}`;
}

function activityProfileModalId(botKey) {
  return `bridge:activityprofilemodal:${botKey}`;
}

function parseModalBotKey(customId, prefix) {
  if (!customId?.startsWith(prefix)) return null;
  const botKey = customId.slice(prefix.length);
  return botKey ? { botKey } : null;
}

function parseProfileModalId(customId) {
  return parseModalBotKey(customId, 'bridge:profilemodal:');
}

function parseIdentityModalId(customId) {
  return parseModalBotKey(customId, 'bridge:identitymodal:');
}

function parseBannerModalId(customId) {
  return parseModalBotKey(customId, 'bridge:bannermodal:');
}

function parsePresenceHubModalId(customId) {
  return parseModalBotKey(customId, 'bridge:presencehubmodal:');
}

function parseActivityProfileModalId(customId) {
  return parseModalBotKey(customId, 'bridge:activityprofilemodal:');
}

function formatBannerColorHex(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return `#${value.toString(16).padStart(6, '0')}`;
}

function parseBannerColorInput(input) {
  if (!input?.trim()) return undefined;
  const s = input.trim().toLowerCase();
  if (s === 'none' || s === '-' || s === 'clear') return null;
  let hex = s.replace(/^#/, '');
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(t('profile.err.bannerHex'));
  }
  return parseInt(hex, 16);
}

function parseUrlInput(input, label) {
  if (!input?.trim()) return undefined;
  const s = input.trim();
  if (s === '-' || s === 'clear' || s === 'none') return null;
  if (!/^https?:\/\//i.test(s)) {
    throw new Error(t('profile.err.url', { label }));
  }
  // The bot downloads this URL itself: no localhost / private-network targets.
  const { isSafeMediaUrl } = require('../music/linkMeta');
  if (!isSafeMediaUrl(s)) throw new Error(t('profile.err.url', { label }));
  return s;
}

function parsePresenceModalId(customId) {
  if (!customId?.startsWith('bridge:presencemodal:')) return null;
  const rest = customId.slice('bridge:presencemodal:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  return {
    botKey: rest.slice(0, sep),
    activityType: rest.slice(sep + 1),
  };
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function listBotTargets(panelGuildId = null) {
  const registry = require('../bridge/registry');
  const { getPanelGuild, botDisplayLabel } = require('./roomLabel');
  const panelGuild = panelGuildId
    ? registry.state.master?.client?.guilds.cache.get(String(panelGuildId)) ?? null
    : getPanelGuild(registry.state.master?.client);
  const filterGuild = panelGuildId ? String(panelGuildId) : null;
  const out = [];
  for (const [regKey, entry] of registry.state.slaves) {
    if (!entry.client?.user) continue;
    if (filterGuild && String(entry.cfg?.guildId) !== filterGuild) continue;
    const slaveName = entry.name ?? String(regKey).split(':').pop();
    out.push({
      botKey: String(regKey),
      client: entry.client,
      guildId: entry.cfg?.guildId ?? null,
      label: botDisplayLabel(panelGuild, slaveName),
    });
  }
  return out;
}

function getGuildBulkConnectionStatus(guildId) {
  if (!guildId) return { total: 0, connected: 0, allConnected: true };
  const botStore = require('./botStore');
  const total = botStore.listSlaves(guildId).length;
  if (!total) return { total: 0, connected: 0, allConnected: true };
  const connected = listBotTargets(guildId).length;
  return { total, connected, allConnected: connected >= total };
}

function bulkEditWaitMessage(guildId) {
  const st = getGuildBulkConnectionStatus(guildId);
  return t('profile.bulk.waitAllConnected', { connected: st.connected, total: st.total });
}

function firstSlaveBotKey(guildId = null) {
  const targets = listBotTargets(guildId);
  if (targets.length) {
    const name = targets[0].botKey.split(':').pop();
    return name || targets[0].botKey;
  }
  const botStore = require('./botStore');
  return botStore.listSlaves(guildId)[0]?.name || null;
}

function resolveTextTemplate(template, botKey, guild = null) {
  const t = String(template).trim();
  if (!t) return null;
  const { botDisplayLabel } = require('./roomLabel');
  const label = botDisplayLabel(guild, botKey);
  return t.replace(/\{n\}/gi, label).replace(/\{#\}/g, label).trim();
}

function resolveUsernameTemplate(template, botKey, guild = null) {
  const resolved = resolveTextTemplate(template, botKey, guild);
  return resolved ? resolved.slice(0, 32) : null;
}

function resolveDisplayNameTemplate(template, botKey, guild = null) {
  const resolved = resolveTextTemplate(template, botKey, guild);
  return resolved ? resolved.slice(0, 32) : null;
}

function getClientForBotKey(botKey, guildId = null) {
  const registry = require('../bridge/registry');
  if (botKey === 'master') return registry.state.master?.client ?? null;
  const entry = registry.getSlaveEntry(guildId, botKey);
  return entry?.client ?? null;
}

function getVoiceLockerForBotKey(botKey, guildId = null) {
  const registry = require('../bridge/registry');
  if (botKey === 'master') return registry.state.master?.client?._voiceLocker ?? null;
  return registry.getSlaveEntry(guildId, botKey)?.voice ?? null;
}

function formatSummary(botKey, guild = null) {
  const client = getClientForBotKey(botKey, guild?.id);
  const saved = profileStore.get(botKey, guild?.id);
  if (!client?.user && !saved) return t('profile.noData');

  const g = guild || (client ? require('./roomLabel').getPanelGuild(client) : null);
  const lines = [];

  if (client?.user) {
    lines.push(`${t('profile.username')} ${client.user.username}`);
    const nick = g?.members.cache.get(client.user.id)?.nickname;
    if (nick) lines.push(`${t('profile.displayName')} ${nick}`);
    const accent = client.user.accentColor ?? saved?.bannerColor;
    if (accent != null) lines.push(`${t('profile.bannerColor')} ${formatBannerColorHex(accent)}`);
    if (client.user.banner) lines.push(t('profile.bannerImage'));
  } else if (saved?.bannerColor != null) {
    lines.push(`${t('profile.bannerColor')} ${formatBannerColorHex(saved.bannerColor)}`);
  }

  const status = saved?.presenceStatus || 'online';
  lines.push(`${t('profile.status')} ${status}`);

  if (saved?.activityType && saved.activityType !== 'none' && saved.activityText) {
    let act = `${t('profile.activity')} ${activityLabel(saved.activityType)} ${saved.activityText}`;
    if (saved.activityType === 'streaming' && saved.activityUrl) {
      act += ` (${saved.activityUrl})`;
    }
    lines.push(act);
  } else {
    lines.push(`${t('profile.activity')} ${t('profile.activityOff')}`);
  }

  if (saved?.updatedAt) {
    lines.push(t('profile.updated', { date: new Date(saved.updatedAt).toLocaleString() }));
  }

  const { formatAllowedChatRoles } = require('./chatAccess');
  const accessKey = botKey === BULK_BOT_KEY
    ? (firstSlaveBotKey(guild?.id) || botKey)
    : botKey;
  lines.push(`${t('profile.chatAccess')} ${formatAllowedChatRoles(g, accessKey)}`);

  return lines.join('\n');
}

function buildIdentityModalContent(botKey, guild, modalId) {
  const client = getClientForBotKey(botKey, guild?.id);
  const { botDisplayLabel, getPanelGuild } = require('./roomLabel');
  const g = guild || getPanelGuild(client);
  const titleLabel = botDisplayLabel(guild, botKey);
  const username = client?.user?.username ?? '';
  const displayName = (g && client?.user)
    ? (g.members.cache.get(client.user.id)?.nickname ?? '')
    : '';

  return new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(t('profile.modal.identity', { label: titleLabel }))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('username')
          .setLabel(t('profile.field.username'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.username'))
          .setValue(username.slice(0, 400)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('display_name')
          .setLabel(t('profile.field.displayName'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.display'))
          .setValue(displayName.slice(0, 400)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('avatar_url')
          .setLabel(t('profile.field.avatar'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.avatar'))
          .setValue(''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(t('profile.field.about'))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.about'))
          .setValue(''),
      ),
    );
}

function buildIdentityModal(botKey, guild = null) {
  return buildIdentityModalContent(botKey, guild, identityModalId(botKey));
}

function buildProfileModal(botKey, guild = null) {
  return buildIdentityModalContent(botKey, guild, profileModalId(botKey));
}

function buildBulkIdentityModalContent(modalId, guild = null) {
  const saved = profileStore.get(BULK_BOT_KEY, guild?.id) || {};
  return new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(t('profile.modal.allIdentity'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('username')
          .setLabel(t('profile.field.usernameTpl'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.usernameTpl'))
          .setValue(saved.username ? String(saved.username).slice(0, 400) : ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('display_name')
          .setLabel(t('profile.field.displayTpl'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.displayTpl'))
          .setValue(saved.displayName ? String(saved.displayName).slice(0, 400) : ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('avatar_url')
          .setLabel(t('profile.field.avatarAll'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.avatar'))
          .setValue(saved.avatarUrl ? String(saved.avatarUrl).slice(0, 400) : ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('description')
          .setLabel(t('profile.field.aboutAll'))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.about'))
          .setValue(''),
      ),
    );
}

function buildBulkIdentityModal(guild = null) {
  return buildBulkIdentityModalContent(identityModalId(BULK_BOT_KEY), guild);
}

function buildBulkProfileModal(guild = null) {
  return buildBulkIdentityModalContent(profileModalId(BULK_BOT_KEY), guild);
}

function buildBannerModal(botKey, guild = null) {
  const saved = profileStore.get(botKey, guild?.id) || {};
  const client = getClientForBotKey(botKey, guild?.id);
  const { botDisplayLabel } = require('./roomLabel');
  const bannerColor = saved.bannerColor ?? client?.user?.accentColor;

  return new ModalBuilder()
    .setCustomId(bannerModalId(botKey))
    .setTitle(t('profile.modal.banner', { label: botDisplayLabel(guild, botKey) }))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banner_color')
          .setLabel(t('profile.field.bannerColor'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.banner'))
          .setValue(bannerColor != null ? formatBannerColorHex(bannerColor) : ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banner_url')
          .setLabel(t('profile.field.bannerUrl'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.bannerUrl'))
          .setValue(''),
      ),
    );
}

function buildBulkBannerModal(guild = null) {
  const saved = profileStore.get(BULK_BOT_KEY, guild?.id) || {};
  return new ModalBuilder()
    .setCustomId(bannerModalId(BULK_BOT_KEY))
    .setTitle(t('profile.modal.allBanner'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banner_color')
          .setLabel(t('profile.field.bannerAll'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.bannerAll'))
          .setValue(saved.bannerColor != null ? formatBannerColorHex(saved.bannerColor) : ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('banner_url')
          .setLabel(t('profile.field.bannerUrlAll'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(t('profile.ph.bannerUrl'))
          .setValue(''),
      ),
    );
}

function buildPresenceStatusRow(saved) {
  return new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('presence_status')
      .setLabel(t('profile.field.status'))
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder(t('profile.ph.status'))
      .setValue(saved.presenceStatus && saved.presenceStatus !== 'online'
        ? saved.presenceStatus
        : ''),
  );
}

function buildPresenceActivityRows(saved) {
  return [
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('activity_type')
        .setLabel(t('profile.field.actType'))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder(t('profile.ph.actType'))
        .setValue(saved.activityType && saved.activityType !== 'none' ? saved.activityType : ''),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('activity_text')
        .setLabel(t('profile.field.actText'))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder(t('profile.ph.actText'))
        .setValue(saved.activityText ? String(saved.activityText).slice(0, 128) : ''),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('stream_url')
        .setLabel(t('profile.field.streamUrl'))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder(t('profile.ph.stream'))
        .setValue(saved.activityUrl ? String(saved.activityUrl).slice(0, 400) : ''),
    ),
  ];
}

function buildPresenceHubModalContent(botKey, guild, modalId) {
  const saved = profileStore.get(botKey, guild?.id) || {};
  const { botDisplayLabel } = require('./roomLabel');

  return new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(t('profile.modal.presence', { label: botDisplayLabel(guild, botKey) }))
    .addComponents(buildPresenceStatusRow(saved), ...buildPresenceActivityRows(saved));
}

function buildPresenceHubModal(botKey, guild = null) {
  return buildPresenceHubModalContent(botKey, guild, presenceHubModalId(botKey));
}

function buildActivityProfileModal(botKey, guild = null) {
  return buildPresenceHubModalContent(botKey, guild, activityProfileModalId(botKey));
}

function buildBulkPresenceHubModal(guild = null) {
  return buildPresenceHubModalContent(BULK_BOT_KEY, guild, presenceHubModalId(BULK_BOT_KEY));
}

function buildBulkActivityProfileModal(guild = null) {
  return buildPresenceHubModalContent(BULK_BOT_KEY, guild, activityProfileModalId(BULK_BOT_KEY));
}

function normalizeIdentityPatch(raw) {
  const patch = {};
  const username = raw.username?.trim();
  const displayName = raw.display_name?.trim();
  const avatarUrl = raw.avatar_url?.trim();

  if (username) {
    if (username.length < 2 || username.length > 32) {
      throw new Error(t('profile.err.username'));
    }
    patch.username = username;
  }
  if (displayName) {
    if (displayName === '-') {
      patch.displayName = null;
    } else {
      if (displayName.length < 1 || displayName.length > 32) {
        throw new Error(t('profile.err.displayName'));
      }
      patch.displayName = displayName;
    }
  }
  if (avatarUrl) {
    patch.avatarUrl = parseUrlInput(avatarUrl, 'Avatar');
  }
  const description = raw.description?.trim();
  if (description) patch.description = description.slice(0, 400);
  return patch;
}

function normalizeBannerPatch(raw) {
  const patch = {};
  if (raw.banner_color?.trim()) {
    patch.bannerColor = parseBannerColorInput(raw.banner_color);
  }
  if (raw.banner_url != null && String(raw.banner_url).trim()) {
    patch.bannerUrl = parseUrlInput(raw.banner_url, 'Banner image');
  }
  return patch;
}

function resolveActivityFields(raw) {
  const typeRaw = raw.activity_type?.trim() ?? '';
  let textRaw = raw.activity_text?.trim() ?? '';
  let typeKey = typeRaw.toLowerCase();

  if (typeKey && ACTIVITY_ALIASES[typeKey]) {
    typeKey = ACTIVITY_ALIASES[typeKey];
  }

  if (typeKey && !isActivityTypeKey(typeKey) && typeKey !== 'none' && typeKey !== '-') {
    const space = typeKey.indexOf(' ');
    if (space > 0) {
      const first = typeKey.slice(0, space);
      const rest = typeRaw.slice(typeRaw.indexOf(' ') + 1).trim();
      const resolved = ACTIVITY_ALIASES[first] || first;
      if (isActivityTypeKey(resolved)) {
        typeKey = resolved;
        if (!textRaw) textRaw = rest;
      }
    } else if (!textRaw) {
      textRaw = typeRaw;
      typeKey = 'playing';
    }
  }

  return { typeKey, textRaw };
}

function normalizeActivityPatch(raw) {
  const patch = {};
  const { typeKey: activityType, textRaw: activityText } = resolveActivityFields(raw);
  const streamUrl = raw.stream_url?.trim() ?? '';
  const streamClear = streamUrl === '-';
  const textClear = raw.activity_text?.trim() === '-';

  if (textClear) {
    patch.activityType = 'none';
    patch.activityText = null;
    patch.activityUrl = null;
    return patch;
  }

  if (streamClear && !activityType && !activityText) {
    patch.activityUrl = null;
    return patch;
  }

  if (!activityType && !activityText && !streamUrl) return patch;

  if (activityType === 'none' || activityType === '-') {
    patch.activityType = 'none';
    patch.activityText = null;
    patch.activityUrl = null;
    return patch;
  }

  if (activityType) {
    if (!isActivityTypeKey(activityType)) {
      throw new Error(t('profile.err.actType'));
    }
    if (!activityText) {
      throw new Error(t('profile.err.actText'));
    }
    patch.activityType = activityType;
    patch.activityText = activityText.slice(0, 128);
    if (activityType === 'streaming') {
      if (!streamUrl || streamClear) {
        throw new Error(t('profile.err.streamUrl'));
      }
      patch.activityUrl = parseUrlInput(streamUrl, 'Stream');
    } else {
      patch.activityUrl = null;
    }
    return patch;
  }

  if (activityText) {
    patch.activityType = 'playing';
    patch.activityText = activityText.slice(0, 128);
    if (streamClear) patch.activityUrl = null;
  }
  return patch;
}

function normalizePresenceStatusPatch(raw) {
  const patch = {};
  const status = raw.presence_status?.trim().toLowerCase();
  if (status === '-') {
    patch.presenceStatus = 'online';
  } else if (status) {
    if (!VALID_STATUSES.has(status)) {
      throw new Error(t('profile.err.status'));
    }
    patch.presenceStatus = status;
  }
  return patch;
}

function normalizeRpcPatch(raw) {
  return normalizeActivityPatch(raw);
}

function normalizePresencePatch(raw) {
  return {
    ...normalizeRpcPatch(raw),
    ...normalizePresenceStatusPatch(raw),
  };
}

function normalizePatch(raw) {
  return {
    ...normalizeIdentityPatch(raw),
    ...normalizeBannerPatch(raw),
    ...normalizePresencePatch(raw),
  };
}

function buildActivities(saved) {
  const typeKey = saved?.activityType;
  const text = saved?.activityText?.trim();
  if (!typeKey || typeKey === 'none') return [];

  if (typeKey === 'custom') {
    if (!text) return [];
    return [{ type: ActivityType.Custom, name: 'Custom Status', state: text.slice(0, 128) }];
  }

  if (!text) return [];

  const type = ACTIVITY_MAP[typeKey] ?? ActivityType.Playing;
  const activity = { name: text.slice(0, 128), type };

  if (typeKey === 'streaming' && saved.activityUrl?.trim()) {
    activity.url = saved.activityUrl.trim();
  }

  return [activity];
}

function buildPresencePayload(saved) {
  const status = saved?.presenceStatus && VALID_STATUSES.has(saved.presenceStatus)
    ? saved.presenceStatus
    : 'online';
  return {
    status,
    activities: buildActivities(saved || {}),
    afk: false,
    since: null,
  };
}

function hasSavedPresence(saved) {
  if (!saved) return false;
  if (saved.presenceStatus && saved.presenceStatus !== 'online') return true;
  const type = saved.activityType;
  return Boolean(type && type !== 'none');
}

function applyPresenceFromSaved(client, saved) {
  if (!client?.user) return;

  const payload = buildPresencePayload(saved);
  client.user.setPresence(payload);
  const parsed = client.presence._parse(payload);
  if (client.options?.ws) {
    client.options.ws.presence = parsed;
  }
}

function mergePersisted(botKey, patch, guildId = null) {
  const persist = pickPersistPatch(botKey, patch, guildId);
  return Object.keys(persist).length
    ? profileStore.merge(botKey, persist, guildId)
    : (profileStore.get(botKey, guildId) || {});
}

async function applyPresencePatch(client, botKey, patch, tag = '[PROFILE]') {
  const saved = mergePersisted(botKey, patch);
  applyPresenceFromSaved(client, saved);
  client._refreshPresence?.('patch');
  console.log(`${tag} Presence for **${botKey}**: ${saved.presenceStatus || 'online'} / ${saved.activityType || 'none'}`);
  return saved;
}

async function applyGuildDisplayName(client, botKey, displayName, tag, guildId = null) {
  const { getPanelGuild } = require('./roomLabel');
  const guild = getPanelGuild(client, guildId);
  if (!guild) throw new Error(t('profile.err.guildDisplay'));
  await guild.members.editMe({ nick: displayName ?? null });
  console.log(`${tag} Display name for **${botKey}**: ${displayName || '(cleared)'}`);
}

async function applyBannerColor(client, botKey, bannerColor, tag) {
  await client.rest.patch(Routes.user(), {
    body: { accent_color: bannerColor ?? null },
  });
  console.log(`${tag} Banner color for **${botKey}**: ${bannerColor != null ? formatBannerColorHex(bannerColor) : '(cleared)'}`);
}

async function applyBannerImage(client, botKey, bannerUrl, tag) {
  await client.user.setBanner(bannerUrl ?? null);
  console.log(`${tag} Banner image for **${botKey}**: ${bannerUrl ? 'set' : '(cleared)'}`);
}

async function applyBotRoles(guild, client, roleIds, tag = '[PROFILE]') {
  if (!guild) throw new Error(t('profile.err.guildRoles'));
  const member = guild.members.cache.get(client.user.id)
    ?? await guild.members.fetch(client.user.id).catch(() => null);
  if (!member) throw new Error(t('profile.err.botMember'));

  const actor = guild.members.me;
  if (!actor?.permissions.has('ManageRoles')) {
    throw new Error(t('profile.err.manageRoles'));
  }

  const manageable = [];
  const skipped = [];
  for (const id of roleIds) {
    const role = guild.roles.cache.get(id);
    if (!role) {
      skipped.push(id);
      continue;
    }
    if (!role.editable || role.position >= actor.roles.highest.position) {
      skipped.push(role.name);
      continue;
    }
    manageable.push(id);
  }

  await member.roles.set(manageable);
  console.log(`${tag} Roles for **${client.user.tag}**: ${manageable.length} set, ${skipped.length} skipped`);
  return { ok: true, applied: manageable.length, skipped };
}

async function applyProfile(client, botKey, tag = '[PROFILE]', opts = {}) {
  if (opts.presenceOnly !== true) {
    throw new Error('applyProfile without presenceOnly is deprecated — use saveAndApply');
  }

  const saved = profileStore.get(botKey);
  if (!hasSavedPresence(saved)) {
    return { ok: true, applied: [] };
  }

  try {
    applyPresenceFromSaved(client, saved);
    console.log(`${tag} Restored presence for **${botKey}**`);
    return { ok: true, applied: ['presence'] };
  } catch (err) {
    console.warn(`${tag} Presence restore failed for **${botKey}**:`, err.message);
    return { ok: false, errors: [err.message] };
  }
}

/** Other guilds this bot account serves (shared slave tokens): global profile edits would change it there too. */
function otherGuildsSharingClient(client, guildId) {
  if (!client || !guildId) return [];
  const registry = require('../bridge/registry');
  const out = new Set();
  for (const e of registry.state.slaves.values()) {
    if (e.client === client && e.cfg?.guildId && String(e.cfg.guildId) !== String(guildId)) out.add(String(e.cfg.guildId));
  }
  return [...out];
}

const GLOBAL_PROFILE_KEYS = ['username', 'avatarUrl', 'description', 'bannerColor', 'bannerUrl', 'activityType', 'activityText', 'presenceStatus', 'activityUrl'];

async function applyDiscordPatch(client, botKey, patch, tag = '[PROFILE]', guildId = null) {
  const applied = [];
  const errors = [];

  // A shared bot account must not be renamed/re-skinned by one guild for every other guild.
  const shared = botKey !== 'master' ? otherGuildsSharingClient(client, guildId) : [];
  if (shared.length) {
    const skipped = GLOBAL_PROFILE_KEYS.filter(k => Object.prototype.hasOwnProperty.call(patch, k));
    if (skipped.length) {
      patch = { ...patch };
      for (const k of skipped) delete patch[k];
      errors.push(t('profile.err.sharedBot', { count: shared.length }));
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
    try {
      await applyGuildDisplayName(client, botKey, patch.displayName, tag, guildId);
      applied.push('display name');
    } catch (err) {
      errors.push(`display name: ${err.message}`);
    }
  }

  if (patch.username) {
    try {
      await client.user.setUsername(patch.username);
      applied.push('username');
    } catch (err) {
      errors.push(`username: ${err.message}`);
    }
  }

  if (patch.avatarUrl) {
    try {
      await client.user.setAvatar(patch.avatarUrl);
      applied.push('avatar');
    } catch (err) {
      errors.push(`avatar: ${err.message}`);
    }
  }

  if (patch.description) {
    try {
      await client.application.edit({ description: patch.description });
      applied.push('description');
    } catch (err) {
      errors.push(`description: ${err.message}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'bannerColor')) {
    try {
      await applyBannerColor(client, botKey, patch.bannerColor, tag);
      applied.push('banner color');
    } catch (err) {
      errors.push(`banner color: ${err.message}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'bannerUrl')) {
    try {
      await applyBannerImage(client, botKey, patch.bannerUrl, tag);
      applied.push('banner image');
    } catch (err) {
      errors.push(`banner image: ${err.message}`);
    }
  }

  const hasPresence = Object.prototype.hasOwnProperty.call(patch, 'activityType')
    || Object.prototype.hasOwnProperty.call(patch, 'activityText')
    || Object.prototype.hasOwnProperty.call(patch, 'presenceStatus')
    || Object.prototype.hasOwnProperty.call(patch, 'activityUrl');
  if (hasPresence) {
    try {
      const saved = mergePersisted(botKey, patch);
      applyPresenceFromSaved(client, saved);
      client._refreshPresence?.('patch');
      applied.push('presence');
    } catch (err) {
      errors.push(`presence: ${err.message}`);
    }
  }

  if (applied.length) {
    console.log(`${tag} Applied for **${botKey}**: ${applied.join(', ')}`);
  }
  if (errors.length) {
    console.warn(`${tag} Profile issues for **${botKey}**: ${errors.join('; ')}`);
  }

  return { ok: errors.length === 0, applied, errors };
}

async function saveAndApply(client, botKey, raw, tag = '[PROFILE]', guildId = null) {
  const patch = normalizePatch(raw);
  mergePersisted(botKey, patch, guildId);
  return applyDiscordPatch(client, botKey, patch, tag, guildId);
}

async function saveAndApplyPatch(client, botKey, patch, tag = '[PROFILE]', guildId = null) {
  mergePersisted(botKey, patch, guildId);
  return applyDiscordPatch(client, botKey, patch, tag, guildId);
}

async function saveAndApplyIdentity(client, botKey, raw, tag = '[PROFILE]', guildId = null) {
  const patch = normalizeIdentityPatch(raw);
  return applyDiscordPatch(client, botKey, patch, tag, guildId);
}

async function saveAndApplyBanner(client, botKey, raw, tag = '[PROFILE]', guildId = null) {
  const patch = normalizeBannerPatch(raw);
  mergePersisted(botKey, patch, guildId);
  return applyDiscordPatch(client, botKey, patch, tag, guildId);
}

async function saveAndApplyPresence(client, botKey, raw, tag = '[PROFILE]', guildId = null) {
  const patch = normalizePresencePatch(raw);
  mergePersisted(botKey, patch, guildId);
  return applyDiscordPatch(client, botKey, patch, tag, guildId);
}

async function clearAndReset(client, botKey, tag = '[PROFILE]', guildId = null) {
  profileStore.clear(botKey, guildId);
  // Shared account: presence / description / banner are global — reset only this guild's nickname.
  const shared = botKey !== 'master' ? otherGuildsSharingClient(client, guildId) : [];
  if (shared.length) {
    await applyGuildDisplayName(client, botKey, null, tag, guildId).catch(() => {});
    console.log(`${tag} Cleared guild nickname for **${botKey}** (account shared with ${shared.length} other guild(s))`);
    return { ok: true, applied: ['display name'], errors: [t('profile.err.sharedBot', { count: shared.length })] };
  }
  try {
    applyPresenceFromSaved(client, { activityType: 'none', presenceStatus: 'online' });
    await client.application?.edit({ description: '' }).catch(() => {});
    await applyGuildDisplayName(client, botKey, null, tag, guildId).catch(() => {});
    await applyBannerColor(client, botKey, null, tag).catch(() => {});
    await applyBannerImage(client, botKey, null, tag).catch(() => {});
    console.log(`${tag} Cleared profile for **${botKey}**`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
}

async function runBulkPatch(targets, buildPatch, tag, delayMs = 500) {
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const { botKey, client, label, guildId } = targets[i];
    try {
      const patch = buildPatch(botKey);
      const r = await saveAndApplyPatch(client, botKey, patch, tag, guildId);
      results.push({ label, ok: r.ok, applied: r.applied, errors: r.errors });
    } catch (err) {
      results.push({ label, ok: false, errors: [err.message] });
    }
    if (i < targets.length - 1) await delay(delayMs);
  }
  return results;
}

async function saveAndApplyActivityBulk(raw, panelGuildId = null, tag = '[PROFILE]') {
  const targets = listBotTargets(panelGuildId);
  if (!targets.length) throw new Error(t('profile.err.noBots'));
  const presencePatch = normalizePresencePatch(raw);
  mergePersisted(BULK_BOT_KEY, presencePatch, panelGuildId);
  return runBulkPatch(targets, () => presencePatch, tag, 300);
}

async function saveAndApplyPresenceBulk(raw, panelGuildId = null, tag = '[PROFILE]') {
  return saveAndApplyActivityBulk(raw, panelGuildId, tag);
}

async function saveAndApplyBannerBulk(raw, panelGuildId = null, tag = '[PROFILE]') {
  const targets = listBotTargets(panelGuildId);
  if (!targets.length) throw new Error(t('profile.err.noBots'));
  const bannerPatch = normalizeBannerPatch(raw);
  mergePersisted(BULK_BOT_KEY, pickPersistPatch(BULK_BOT_KEY, bannerPatch, panelGuildId), panelGuildId);
  return runBulkPatch(targets, () => bannerPatch, tag, 500);
}

async function saveAndApplyBulk(raw, panelGuildId = null, tag = '[PROFILE]') {
  const targets = listBotTargets(panelGuildId);
  if (!targets.length) throw new Error(t('profile.err.noBots'));

  const registry = require('../bridge/registry');
  const { getPanelGuild } = require('./roomLabel');
  const guild = panelGuildId
    ? registry.state.master?.client?.guilds.cache.get(String(panelGuildId)) ?? null
    : getPanelGuild(targets[0]?.client, targets[0]?.guildId);
  const usernameTemplate = raw.username?.trim();
  const displayNameTemplate = raw.display_name?.trim();
  const sharedPatch = normalizeIdentityPatch(raw);

  mergePersisted(BULK_BOT_KEY, {
    ...pickPersistPatch(BULK_BOT_KEY, sharedPatch, panelGuildId),
    ...(usernameTemplate ? { username: usernameTemplate } : {}),
    ...(displayNameTemplate ? { displayName: displayNameTemplate } : {}),
  }, panelGuildId);

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const { botKey, client, label, guildId } = targets[i];
    const patch = { ...sharedPatch };

    if (usernameTemplate) {
      const name = resolveUsernameTemplate(usernameTemplate, botKey, guild);
      if (!name || name.length < 2 || name.length > 32) {
        results.push({ label, ok: false, errors: [t('profile.err.usernameBulk', { name })] });
        continue;
      }
      patch.username = name;
    }

    if (displayNameTemplate) {
      const nick = resolveDisplayNameTemplate(displayNameTemplate, botKey, guild);
      if (!nick || nick.length < 1 || nick.length > 32) {
        results.push({ label, ok: false, errors: [t('profile.err.displayBulk', { name: nick })] });
        continue;
      }
      patch.displayName = nick;
    }

    try {
      const r = await saveAndApplyPatch(client, botKey, patch, tag, guildId);
      results.push({ label, ok: r.ok, applied: r.applied, errors: r.errors });
    } catch (err) {
      results.push({ label, ok: false, errors: [err.message] });
    }
    if (i < targets.length - 1) await delay(700);
  }
  return results;
}

async function saveAndApplyRolesBulk(guild, roleIds, tag = '[PROFILE]') {
  const targets = listBotTargets(guild?.id);
  if (!targets.length) throw new Error(t('profile.err.noBots'));
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const { client, label } = targets[i];
    try {
      const r = await applyBotRoles(guild, client, roleIds, tag);
      const warn = r.skipped?.length
        ? ` (${r.skipped.length} role(s) skipped — hierarchy or permissions)`
        : '';
      results.push({ label, ok: true, applied: [`${r.applied} roles${warn}`] });
    } catch (err) {
      results.push({ label, ok: false, errors: [err.message] });
    }
    if (i < targets.length - 1) await delay(500);
  }
  return results;
}

async function saveAndApplyRoles(guild, botKey, roleIds, tag = '[PROFILE]') {
  const client = getClientForBotKey(botKey);
  if (!client?.user) throw new Error('Bot not connected.');
  const r = await applyBotRoles(guild, client, roleIds, tag);
  const warn = r.skipped?.length ? ` (${r.skipped.length} skipped)` : '';
  return { ok: true, applied: [`${r.applied} roles${warn}`], errors: [] };
}

async function clearAllProfiles(panelGuildId = null, tag = '[PROFILE]') {
  const targets = listBotTargets(panelGuildId);
  profileStore.clear(BULK_BOT_KEY, panelGuildId);
  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const { botKey, client, label, guildId } = targets[i];
    const r = await clearAndReset(client, botKey, tag, guildId);
    results.push({ label, ok: r.ok, errors: r.errors });
    if (i < targets.length - 1) await delay(300);
  }
  return results;
}

function formatBulkResultLines(results) {
  const ok = results.filter(r => r.ok).length;
  const lines = [t('profile.bulk.updated', { ok, total: results.length })];
  for (const r of results) {
    if (r.ok) {
      const what = r.applied?.length
        ? (Array.isArray(r.applied) ? r.applied.join(', ') : String(r.applied))
        : t('profile.bulk.saved');
      lines.push(t('profile.bulk.ok', { label: r.label, what }));
    } else {
      lines.push(t('profile.bulk.fail', { label: r.label, errors: (r.errors || []).join('; ') }));
    }
  }
  return lines.join('\n').slice(0, 1900);
}

function getClientPresenceOptions(botKey) {
  const saved = profileStore.get(botKey);
  if (!hasSavedPresence(saved)) return undefined;
  return buildPresencePayload(saved);
}

function getSavedProfile(botKey, guildId = null) {
  return profileStore.get(botKey, guildId) || {};
}

module.exports = {
  BULK_BOT_KEY,
  activityLabel,
  profileModalId,
  identityModalId,
  bannerModalId,
  presenceHubModalId,
  activityProfileModalId,
  parseProfileModalId,
  parseIdentityModalId,
  parseBannerModalId,
  parsePresenceHubModalId,
  parseActivityProfileModalId,
  parsePresenceModalId,
  formatSummary,
  formatBannerColorHex,
  buildIdentityModal,
  buildProfileModal,
  buildBulkIdentityModal,
  buildBulkProfileModal,
  buildBannerModal,
  buildBulkBannerModal,
  buildPresenceHubModal,
  buildActivityProfileModal,
  buildBulkPresenceHubModal,
  buildBulkActivityProfileModal,
  applyProfile,
  applyPresenceFromSaved,
  applyPresencePatch,
  applyBotRoles,
  getClientPresenceOptions,
  getSavedProfile,
  saveAndApply,
  saveAndApplyPatch,
  saveAndApplyIdentity,
  saveAndApplyBanner,
  saveAndApplyPresence,
  saveAndApplyBulk,
  saveAndApplyBannerBulk,
  saveAndApplyActivityBulk,
  saveAndApplyPresenceBulk,
  saveAndApplyRoles,
  saveAndApplyRolesBulk,
  normalizePatch,
  normalizeIdentityPatch,
  normalizeBannerPatch,
  normalizePresencePatch,
  normalizePresenceStatusPatch,
  normalizeRpcPatch,
  normalizeActivityPatch,
  clearAndReset,
  clearAllProfiles,
  formatBulkResultLines,
  getClientForBotKey,
  getVoiceLockerForBotKey,
  listBotTargets,
  firstSlaveBotKey,
  getGuildBulkConnectionStatus,
  bulkEditWaitMessage,
};
