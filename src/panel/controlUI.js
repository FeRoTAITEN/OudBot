const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const { VoiceConnectionStatus } = require('@discordjs/voice');
const registry = require('../bridge/registry');
const { getRoomRoster, membersInVoiceChannel, getBridgeSpeakers } = require('./roomRoster');
const MusicManager = require('../music/MusicManager');
const { formatSummary, getClientForBotKey, BULK_BOT_KEY, firstSlaveBotKey, getGuildBulkConnectionStatus } = require('./botProfile');
const { buildPanelHelpEmbed } = require('./panelHelp');
const botStore = require('./botStore');
const { guildBridgeEnabled, guildSlavesEnabled, guildSlaveProfileEditEnabled } = require('./guildPanelFeatures');
const subscriptionStore = require('../subscription/subscriptionStore');
const { contactLinkButton } = require('./contactLink');
const { buildPermsEmbed, buildPermsRows, dashboardLinkButton } = require('./permsPanel');
const { themeForSlave, themeForMaster, roomLabel, slaveRoomLabel, botDisplayLabel, masterChatSelectLabel } = require('./roomLabel');
const { t } = require('../i18n/context');
const { getVoteToSkip } = require('./musicSkipSettings');

const VOLUME_LEVELS = [];
for (let v = 10; v <= 200; v += 10) VOLUME_LEVELS.push(v);

/** Discord select menus: max 25 options per menu. */
const LIST_PAGE_SIZE = 25;
/** Solo menu reserves one slot for "off" on every page. */
const SOLO_ROOMS_PER_PAGE = LIST_PAGE_SIZE - 1;

function cid(action, target, extra) {
  const parts = ['bridge', action];
  if (target) parts.push(target);
  if (extra != null && extra !== '') parts.push(String(extra));
  return parts.join(':');
}

function parseBridgeId(customId) {
  const parts = customId.split(':');
  if (parts[0] !== 'bridge' || parts.length < 2) return null;
  return {
    action: parts[1],
    target: parts[2] ?? null,
    extra: parts.length > 3 ? parts.slice(3).join(':') : null,
  };
}

function parseListPage(extra) {
  const raw = String(extra ?? '').split('~')[0];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseRoomsNavExtra(extra) {
  const parts = String(extra ?? '0~master').split('~');
  return {
    listPage: parseListPage(parts[0]),
    botKey: parts[1] || 'master',
  };
}

function roomsNavExtra(listPage, botKey) {
  return `${listPage}~${botKey || 'master'}`;
}

function botEditNav(botKey, returnView) {
  return `${botKey}~${returnView || 'main'}`;
}

function parseBotEditNav(extra) {
  const parts = String(extra ?? `${BULK_BOT_KEY}~main`).split('~');
  return { botKey: parts[0] || BULK_BOT_KEY, returnView: parts[1] || 'main' };
}

function botEditTitle(guild, botKey) {
  if (botKey === BULK_BOT_KEY) return t('common.allBots');
  if (botKey === 'master') return t('common.master');
  return slaveRoomLabel(guild, botKey);
}

function navPageCount(slaveCount) {
  return Math.max(1, Math.ceil(slaveCount / LIST_PAGE_SIZE));
}

function soloPageCount(slaveCount) {
  return Math.max(1, Math.ceil(slaveCount / SOLO_ROOMS_PER_PAGE));
}

function panelPageCount(slaves) {
  return Math.max(navPageCount(slaves.length), soloPageCount(slaves.length));
}

function slavesOnNavPage(slaves, page) {
  const start = page * LIST_PAGE_SIZE;
  return slaves.slice(start, start + LIST_PAGE_SIZE);
}

function slavesOnSoloPage(slaves, page) {
  const start = page * SOLO_ROOMS_PER_PAGE;
  return slaves.slice(start, start + SOLO_ROOMS_PER_PAGE);
}

function connEmoji(status) {
  if (status === VoiceConnectionStatus.Ready) return '🟢';
  if (status === VoiceConnectionStatus.Connecting || status === VoiceConnectionStatus.Signalling) return '🟡';
  return '🔴';
}

function isConnReady(status) {
  return status === VoiceConnectionStatus.Ready;
}

function isConnOffline(status) {
  return status === 'offline' || status === 'none';
}

function isConnConnecting(status) {
  return status === VoiceConnectionStatus.Connecting || status === VoiceConnectionStatus.Signalling;
}

/** Human voice-connection state ("🟢 Connected") instead of the raw `ready` / `signalling`. */
function voiceText(status) {
  if (isConnReady(status)) return t('conn.ready');
  if (isConnConnecting(status)) return t('conn.connecting');
  return t('conn.offline');
}

/** Human audio-player state ("▶️ Playing") instead of the raw `playing` / `idle`. */
function playerText(status) {
  const key = { playing: 'playing', idle: 'idle', paused: 'paused', autopaused: 'paused', buffering: 'buffering' }[String(status)];
  return key ? t(`player.${key}`) : '—';
}

/** Localized Live / Idle / Silent (registry labels are English keys). */
function actLabel(activity) {
  const key = String(activity?.label || 'Silent').toLowerCase();
  return ['live', 'idle', 'silent'].includes(key) ? t(`activity.${key}`) : String(activity?.label || '');
}

/** "🎵 Title · 1:23/3:45" for a queue that is playing right now (never creates a queue). */
function nowPlayingText(queueKey, max = 48) {
  try {
    const entry = MusicManager.listQueues().find(([k]) => k === queueKey);
    const q = entry?.[1];
    const tr = q?.current;
    if (!tr) return null;
    const title = String(tr.title || '').replace(/[`*_~|[\]]/g, '').trim() || '—';
    const short = title.length > max ? `${title.slice(0, max - 1)}…` : title;
    const ui = require('../music/musicUI');
    const el = ui.getTrackElapsed(tr, q.player?.state?.status);
    const time = tr.durationSec ? ` · ${ui.formatDuration(el)}/${ui.formatDuration(tr.durationSec)}` : '';
    const waiting = q.tracks?.length ? ` · +${q.tracks.length}` : '';
    return `🎵 ${short}${time}${waiting}`;
  } catch {
    return null;
  }
}

function panelShowsSlaves(guild) {
  return guildBridgeEnabled(guild) || guildSlavesEnabled(guild);
}

function collectHealthIssues(master, slaves, bridge = true, slavesEnabled = false) {
  const issues = [];
  const trackSlaves = bridge || slavesEnabled;
  if (!master) {
    issues.push(t('health.masterOffline'));
    return issues;
  }
  if (!master.paused && !isConnReady(master.connStatus)) {
    issues.push(isConnConnecting(master.connStatus)
      ? t('health.masterConnecting')
      : t('health.masterVoiceOffline'));
  }
  if (bridge && !master.paused && !master.bridgeActive) issues.push(t('health.bridgeStopped'));
  if (master.paused) issues.push(t('health.masterPaused'));

  if (!trackSlaves) return issues;

  const offline = slaves.filter(s =>
    isConnOffline(s.connStatus)
    || (!isConnReady(s.connStatus) && !isConnConnecting(s.connStatus)),
  );
  const connecting = slaves.filter(s => isConnConnecting(s.connStatus));
  const collisions = bridge ? slaves.filter(s => s.colliding && !s.parked) : [];
  const parked = bridge ? slaves.filter(s => s.parked) : [];
  const paused = slaves.filter(s => s.paused);

  if (offline.length) issues.push(t('health.slavesOffline', { count: offline.length }));
  if (connecting.length) issues.push(t('health.connecting', { count: connecting.length }));
  if (collisions.length) issues.push(t('health.collisions', { count: collisions.length }));
  if (paused.length) issues.push(t('health.slavesPaused', { count: paused.length }));
  if (parked.length && issues.length) issues.push(t('health.parked', { count: parked.length }));

  return issues;
}

function panelTitle(guild) {
  return guildBridgeEnabled(guild) ? t('panel.title') : t('panel.titleMusic');
}

function buildHealthBar(master, slaves, bridge = true, slavesEnabled = false) {
  const issues = collectHealthIssues(master, slaves, bridge, slavesEnabled);
  if (!issues.length) {
    return bridge ? t('health.allClear') : t('health.allClearMusic');
  }
  return `⚠️ ${issues.join(' · ')}`;
}

function overviewEmbedColor(master, slaves, bridge = true, slavesEnabled = false) {
  const trackSlaves = bridge || slavesEnabled;
  let critical = false;
  let warning = false;

  if (!master) {
    critical = true;
  } else {
    if (bridge && !master.paused && !master.bridgeActive) critical = true;
    if (!master.paused && !isConnReady(master.connStatus) && !isConnConnecting(master.connStatus)) critical = true;
    if (!master.paused && isConnConnecting(master.connStatus)) warning = true;
    if (master.paused) warning = true;
  }

  if (trackSlaves) {
    for (const s of slaves) {
      if (bridge && s.colliding && !s.parked) critical = true;
      if (!isConnReady(s.connStatus) && !isConnConnecting(s.connStatus)) critical = true;
      if (isConnConnecting(s.connStatus)) warning = true;
      if (s.paused) warning = true;
    }
  }

  if (critical) return 0xed4245;
  if (warning) return 0xfaa61a;
  return 0x5865f2;
}

function channelLabel(guild, channelId) {
  if (!guild || !channelId) return `\`${channelId ?? '?'}\``;
  const ch = guild.channels.cache.get(channelId);
  return ch ? `**#${ch.name}**` : `\`${channelId}\``;
}

function formatSlaveSummaryLine(guild, s, bridge = true) {
  const th = themeForSlave(s.name, guild?.id);
  if (s.pending) {
    return `${th.emoji} **#${s.name}** ${t('slave.offlineHint')}`;
  }
  if (!bridge) {
    const voice = isConnReady(s.connStatus) ? '' : ` · ${voiceText(s.connStatus)}`;
    const st = s.paused ? '⏸️' : '🔊';
    const np = nowPlayingText(s.queueKey, 36);
    return `${th.emoji} **${roomLabel(guild, s)}** ${st} · ${np || `${s.activity.emoji} ${actLabel(s.activity)}`}${voice}`;
  }
  const st = s.parked ? '🅿️' : s.colliding ? '⛔' : s.paused ? '⏸️' : s.solo ? '🎧' : s.muted ? '🔇' : s.bridgeEnabled === false ? '📴' : '🔊';
  const soloLead = s.solo ? '🎧 **`SOLO`** │ ' : '';
  const voice = isConnReady(s.connStatus) ? '' : ` · ${voiceText(s.connStatus)}`;
  const np = nowPlayingText(s.queueKey, 30);
  return `${soloLead}${th.emoji} **${roomLabel(guild, s)}** ${st} ${s.volume}% · ${s.activity.emoji} ${actLabel(s.activity)}${np ? ` · ${np}` : ''}${voice}`;
}

function sortSlavesForDisplay(slaves) {
  return [...slaves].sort((a, b) => {
    if (a.solo !== b.solo) return a.solo ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
}

function buildCompactSlaveBlock(guild, slaves, maxChars = 950, bridge = true) {
  if (!slaves.length) return t('common.noSlaves');
  let text = '';
  let shown = 0;
  for (const s of sortSlavesForDisplay(slaves)) {
    const line = `${formatSlaveSummaryLine(guild, s, bridge)}\n`;
    if (text.length + line.length > maxChars) break;
    text += line;
    shown++;
  }
  if (shown < slaves.length) {
    text += t('slave.moreChannels', { count: slaves.length - shown });
  }
  return text.trim();
}

/** Whole days until `expires` (null when not a date). */
function daysLeft(expires) {
  const ms = Date.parse(expires);
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

function panelPlanLabel(f) {
  if (f.lifetime) return t('subs.planLifetime');
  if (f.expires) {
    const until = t('subs.planUntil', { date: f.expires });
    const d = daysLeft(f.expires);
    // Days only while usable: an expired (-0 for the first 24 h) or switched-off plan shows the date alone.
    if (!f.allowed || d == null || d < 1) return until;
    return `${until} · ${d <= 7 ? t('subs.daysLeftWarn', { n: d }) : t('subs.daysLeft', { n: d })}`;
  }
  if (!f.lifetime && !f.expires) return t('subs.planTimedOff');
  return t('subs.planTimed');
}

function panelSubscriptionStatus(f) {
  if (f.allowed) return t('subs.statusActive');
  if (f.expired) return t('subs.statusExpired');
  if (f.active === false) return t('subs.statusOff');
  return t('subs.statusInactive');
}

function buildSubscriptionField(guild) {
  if (!guild?.id) return null;
  const f = subscriptionStore.getGuildFeatures(guild.id);
  const label = f.label || guild.name;
  const value = [
    `**${label}**`,
    `${panelSubscriptionStatus(f)} · ${panelPlanLabel(f)}`,
  ].join('\n');
  return {
    name: t('panel.subscription'),
    value: value.slice(0, 1024),
    inline: false,
  };
}

function buildMainEmbed(guild) {
  const bridge = guildBridgeEnabled(guild);
  const slavesOn = guildSlavesEnabled(guild);
  const showSlaves = panelShowsSlaves(guild);
  const master = registry.getMasterSnapshot(guild?.id);
  const slaves = showSlaves ? registry.getSlaveSnapshots(guild?.id) : [];
  const online = slaves.filter(s => s.connStatus === VoiceConnectionStatus.Ready).length;
  const live = slaves.filter(s => s.lastAt && Date.now() - s.lastAt < 2000).length;

  let masterLine = t('common.notRegistered');
  if (master) {
    const bridgePart = bridge
      ? ` · ${t('common.bridge')}: ${master.bridgeActive ? t('panel.bridgeOn') : t('panel.bridgeOff')}`
      : '';
    masterLine =
      `${connEmoji(master.connStatus)} **${t('common.master')}** · ${master.tag}${master.paused ? t('panel.masterPaused') : ''}\n` +
      `${t('common.channel')}: ${channelLabel(guild, master.channelId)}\n` +
      `${t('common.voice')}: ${master.paused ? t('slave.voiceOff') : voiceText(master.connStatus)} · ${t('common.player')}: ${playerText(master.playerStatus)}${bridgePart}`;
    const np = guild?.id ? nowPlayingText(`guild:${guild.id}`, 60) : null;
    if (np) masterLine += `\n${np}`;
  }

  const soloName = bridge ? registry.getSoloSource(guild?.id) : null;
  let description = bridge
    ? t('panel.description', { count: slaves.length })
    : (slavesOn ? t('panel.descriptionSlaves', { count: slaves.length }) : t('panel.descriptionMusic'));
  if (soloName) {
    const soloSlave = slaves.find(s => s.name === soloName);
    if (soloSlave) {
      description += `\n\n${t('panel.soloActive', { room: roomLabel(guild, soloSlave) })}`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(overviewEmbedColor(master, slaves, bridge, slavesOn))
    .setTitle(panelTitle(guild))
    .setDescription(description)
    .addFields(
      { name: t('panel.health'), value: buildHealthBar(master, slaves, bridge, slavesOn), inline: false },
    );

  const subField = buildSubscriptionField(guild);
  if (subField) embed.addFields(subField);

  embed.addFields({ name: t('panel.master'), value: masterLine, inline: false });

  if (showSlaves) {
    embed.addFields({
      name: t('panel.slaves', { online, total: slaves.length, live }),
      value: buildCompactSlaveBlock(guild, slaves, 950, bridge),
      inline: false,
    });
  }

  return embed
    .setFooter({ text: t('panel.footer') })
    .setTimestamp();
}

function userMuteNavExtra(userMutePage, view, slaveName = null) {
  if (view === 'slave' && slaveName) return `${userMutePage}~slave~${slaveName}`;
  return `${userMutePage}~${view}`;
}

function parseUserMuteNavExtra(extra) {
  const parts = String(extra ?? '0~mixer').split('~');
  return {
    userMutePage: parseListPage(parts[0]),
    view: parts[1] || 'mixer',
    slaveName: parts[2] || null,
  };
}

function formatBridgeSpeakersBlock(guild, slaveName = null, max = 14) {
  const speakers = getBridgeSpeakers(guild, slaveName);
  if (!speakers.length) {
    return slaveName ? t('slave.nobodyVoice') : t('slave.nobodySlaves');
  }
  const lines = speakers.slice(0, max).map(s => {
    const muted = registry.isUserBridgeMuted(s.sourceKey);
    const room = slaveName ? '' : ` · ${s.roomLabel}`;
    return `${muted ? '🔇' : s.speaking ? '🟢' : '🎤'} **${s.displayName}**${room}`;
  });
  if (speakers.length > max) lines.push(t('slave.morePeople', { count: speakers.length - max }));
  return lines.join('\n').slice(0, 1024);
}

function userMutePageCount(speakerCount) {
  return Math.max(1, Math.ceil(speakerCount / LIST_PAGE_SIZE));
}

function userMuteSelectRow(guild, view, userMutePage = 0, slaveName = null) {
  const speakers = getBridgeSpeakers(guild, slaveName);
  if (!speakers.length) return null;

  const pages = userMutePageCount(speakers.length);
  const start = userMutePage * LIST_PAGE_SIZE;
  const chunk = speakers.slice(start, start + LIST_PAGE_SIZE);
  const options = chunk.map(s => {
    const muted = registry.isUserBridgeMuted(s.sourceKey);
    return new StringSelectMenuOptionBuilder()
      .setLabel(s.displayName.slice(0, 100))
      .setDescription(
        `${s.roomLabel} · ${muted ? t('slave.mutedSelect') : t('slave.liveSelect')}`.slice(0, 100),
      )
      .setValue(s.sourceKey);
  });

  const from = start + 1;
  const to = start + chunk.length;
  const scope = slaveName ? slaveRoomLabel(guild, slaveName) : t('mixer.allChannels');

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('usermutesel', view, userMuteNavExtra(userMutePage, view, slaveName)))
      .setPlaceholder(
        pages > 1
          ? t('mixer.mutePerson', { scope, from, to, total: speakers.length })
          : t('mixer.mutePersonAll', { scope, total: speakers.length }),
      )
      .addOptions(options),
  );
}

function userMutePageRow(userMutePage, pages, view, slaveName = null) {
  if (pages <= 1) return null;
  const row = new ActionRowBuilder();
  const nav = (p) => userMuteNavExtra(p, view, slaveName);
  if (userMutePage > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('listpage', 'usermute', nav(userMutePage - 1)))
        .setLabel(t('mixer.peoplePrev'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(cid('listpage', 'usermute', 'x'))
      .setLabel(t('mixer.peoplePage', { page: userMutePage + 1, pages }))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
  if (userMutePage < pages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('listpage', 'usermute', nav(userMutePage + 1)))
        .setLabel(t('mixer.peopleNext'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

function buildMasterEmbed(guild) {
  const m = registry.getMasterSnapshot(guild?.id);
  if (!m) {
    return new EmbedBuilder().setColor(0xed4245).setTitle(t('common.master')).setDescription(t('master.notReady'));
  }

  const embed = new EmbedBuilder()
    .setColor(themeForMaster().color)
    .setTitle(t('master.title'))
    .addFields(
      { name: t('common.account'), value: String(m.tag ?? '—'), inline: true },
      { name: t('master.voiceRoom'), value: channelLabel(guild, m.channelId), inline: true },
      { name: t('master.chatRoom'), value: channelLabel(guild, m.textChannelId), inline: true },
    );

  if (guildBridgeEnabled(guild)) {
    embed.addFields({
      name: t('master.bridgeRelay'),
      value: m.bridgeActive ? t('master.bridgeActive') : t('master.bridgeStopped'),
      inline: true,
    });
  }

  embed.addFields(
      { name: t('common.status'), value: m.paused ? `⏸️ ${t('common.paused')}` : `▶️ ${t('common.active')}`, inline: true },
      { name: t('common.voice'), value: m.paused ? t('slave.voiceOff') : voiceText(m.connStatus), inline: true },
      { name: t('common.player'), value: playerText(m.playerStatus), inline: true },
      {
        name: t('common.skipMode'),
        value: `${skipModeLabel(getVoteToSkip('master', guild?.id))}\n_${t('panel.serverSkipDefault')}_`,
        inline: true,
      },
    );

  appendRosterFields(embed, guild, m.channelId);
  embed.setFooter({
    text: guildBridgeEnabled(guild) ? t('master.footer') : t('master.footerMusic'),
  });
  return embed;
}

function buildRoomsEmbed(guild) {
  const showSlaves = panelShowsSlaves(guild);
  const master = registry.getMasterSnapshot(guild?.id);
  const slaves = showSlaves ? registry.getSlaveSnapshots(guild?.id) : [];
  const lines = [];

  if (master) {
    lines.push(
      `**${botDisplayLabel(guild, 'master')}** · ${t('rooms.chat')}: ${channelLabel(guild, master.textChannelId)}`,
    );
  } else {
    lines.push(`**${t('common.master')}** — ${t('common.notReady')}`);
  }

  if (showSlaves) {
    if (!slaves.length) {
      lines.push(t('common.noSlaves'));
    } else {
      for (const s of slaves) {
        const status = s.pending
          ? `🔴 ${t('rooms.offline')}`
          : isConnReady(s.connStatus)
            ? `🟢 ${t('common.inVoice')}`
            : `🟡 \`${s.connStatus}\``;
        lines.push(
          `${status} · **${roomLabel(guild, s)}** · ${t('rooms.chat')}: ${channelLabel(guild, s.textChannelId)}`,
        );
      }
    }
  }

  return new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(t('rooms.title'))
    .setDescription(lines.join('\n').slice(0, 4000))
    .setFooter({ text: t('rooms.footer') });
}

function buildMixerEmbed(guild) {
  const slaves = registry.getSlaveSnapshots(guild?.id);
  const solo = registry.getSoloSource(guild?.id);
  const soloNote = solo
    ? t('mixer.soloNote', { room: roomLabel(guild, slaves.find(s => s.name === solo) || { name: solo }) })
    : '';

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(t('mixer.title', { count: slaves.length }))
    .setDescription(buildCompactSlaveBlock(guild, slaves, 2800) + soloNote)
    .addFields({
      name: t('mixer.peopleOnBridge'),
      value: formatBridgeSpeakersBlock(guild),
      inline: false,
    })
    .setFooter({ text: t('mixer.footer') });
}

function mixerPresetsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('action', 'mixer', 'muteall'))
      .setLabel(t('mixer.muteAll'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔇'),
    new ButtonBuilder()
      .setCustomId(cid('action', 'mixer', 'unmuteall'))
      .setLabel(t('mixer.unmuteAll'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔊'),
    new ButtonBuilder()
      .setCustomId(cid('action', 'mixer', 'resetvol'))
      .setLabel(t('mixer.resetVolumes'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎚️'),
  );
}

function appendRosterFields(embed, guild, channelId) {
  const roster = getRoomRoster(guild, channelId);

  if (roster.organizers) {
    embed.addFields({ name: t('roster.organizers'), value: roster.organizers, inline: false });
  }
  if (roster.attendees) {
    embed.addFields({ name: t('roster.attendees'), value: roster.attendees, inline: false });
  }
  if (roster.everyone) {
    embed.addFields({
      name: t('roster.inChannel', { count: roster.count }),
      value: roster.everyone,
      inline: false,
    });
  } else if (!roster.organizers && roster.count === 0) {
    embed.addFields({ name: t('roster.inChannelEmpty'), value: t('roster.nobody'), inline: false });
  } else if (roster.organizers && !roster.attendees) {
    embed.addFields({ name: t('roster.attendees'), value: t('roster.nobodyElse'), inline: false });
  }

  return embed;
}

function buildSlaveEmbed(guild, name) {
  const bridge = guildBridgeEnabled(guild);
  const slaves = registry.getSlaveSnapshots(guild?.id);
  const s = slaves.find(x => x.name === String(name));
  if (!s) {
    return new EmbedBuilder().setColor(0xed4245).setTitle(t('common.slave')).setDescription(t('slave.notFound'));
  }
  const th = themeForSlave(s.name, guild?.id);

  const embed = new EmbedBuilder()
    .setColor(s.pending ? 0xed4245 : th.color)
    .setTitle(`${th.emoji} ${roomLabel(guild, s)}`);

  if (s.pending) {
    embed.setDescription(t('slave.offlineDesc'));
  } else if (!isConnReady(s.connStatus)) {
    embed.setDescription(t('slave.connectingDesc', { status: s.connStatus }));
  }

  embed.addFields(
      { name: t('common.account'), value: String(s.tag ?? '—'), inline: true },
      { name: t('slave.voiceRoom'), value: channelLabel(guild, s.channelId), inline: true },
      { name: t('slave.chatRoom'), value: channelLabel(guild, s.textChannelId), inline: true },
    );

  if (bridge) {
    embed.addFields({
      name: t('common.bridge'),
      value: s.colliding
        ? t('slave.bridgeCollision')
        : s.paused
          ? t('slave.bridgePaused')
          : s.bridgeEnabled === false
            ? t('slave.bridgeOff')
            : s.solo
              ? t('slave.bridgeSolo')
              : s.muted
                ? t('slave.bridgeMuted')
                : `🔊 ${s.volume}%`,
      inline: true,
    });
  }

  embed.addFields(
      { name: t('common.voice'), value: s.paused ? t('slave.voiceOff') : `\`${s.connStatus}\``, inline: true },
      { name: t('slave.musicPlayer'), value: `\`${s.playerStatus}\``, inline: true },
      {
        name: t('common.skipMode'),
        value: `${skipModeLabel(getVoteToSkip(s.name, guild?.id))}\n_${t('panel.slaveSkipInMenu')}_`,
        inline: true,
      },
    );

  if (bridge) {
    embed.addFields(
      { name: t('slave.audioFeed'), value: `${s.activity.emoji} ${actLabel(s.activity)} · ~${s.fps} fps`, inline: true },
      { name: t('common.profile'), value: formatSummary(s.name, guild), inline: false },
    );
    embed.addFields({
      name: t('slave.bridgeMute'),
      value: formatBridgeSpeakersBlock(guild, s.name, 10),
      inline: false,
    });
  } else {
    embed.addFields({ name: t('common.profile'), value: formatSummary(s.name, guild), inline: false });
  }

  appendRosterFields(embed, guild, s.channelId);

  const queue = MusicManager.getQueue(s.queueKey);
  if (queue.djStats?.size) {
    const djs = [...queue.djStats.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([uid, n], i) => `${['🥇', '🥈', '🥉', '4.', '5.'][i]} <@${uid}> · ${n} plays`)
      .join('\n');
    embed.addFields({ name: t('slave.topMusic'), value: djs.slice(0, 1024), inline: false });
  }

  embed.setFooter({ text: t('slave.footer') });
  return embed;
}

function voiceRoomSelectRow(botKey, placeholder) {
  const key = botKey === 'master' ? 'master' : String(botKey);
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(cid('room', 'voice', key))
      .setPlaceholder(placeholder || t('select.voiceRoom'))
      .addChannelTypes(ChannelType.GuildVoice)
      .setMinValues(1)
      .setMaxValues(1),
  );
}

function textRoomSelectRow(botKey, placeholder) {
  const key = botKey === 'master' ? 'master' : String(botKey);
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(cid('room', 'text', key))
      .setPlaceholder(placeholder || t('select.chatRoom'))
      .addChannelTypes(
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.GuildVoice,
      )
      .setMinValues(1)
      .setMaxValues(1),
  );
}

function resolveRefreshId(current, slaveName, listPage) {
  if (current === 'slave' && slaveName) return cid('refresh', 'slave', slaveName);
  if (current === 'botedit' && slaveName) return cid('refresh', 'botedit', slaveName);
  if (current === 'rooms') return cid('refresh', 'rooms', roomsNavExtra(listPage, slaveName));
  return cid('refresh', current, String(listPage));
}

function navTabRow(current = 'main', slaveName = null, listPage = 0, guild = null) {
  const roomsNav = roomsNavExtra(listPage, slaveName);
  const bridge = guildBridgeEnabled(guild);
  const buttons = [
    new ButtonBuilder()
      .setCustomId(cid('view', 'main', String(listPage)))
      .setLabel(t('nav.overview'))
      .setStyle(current === 'main' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('🏠'),
  ];
  if (bridge) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(cid('view', 'mixer', String(listPage)))
        .setLabel(t('nav.mixer'))
        .setStyle(current === 'mixer' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setEmoji('🎚️'),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(cid('view', 'master'))
      .setLabel(t('nav.master'))
      .setStyle(current === 'master' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('📢'),
    new ButtonBuilder()
      .setCustomId(cid('view', 'rooms', roomsNav))
      .setLabel(t('nav.rooms'))
      .setStyle(current === 'rooms' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('📍'),
    new ButtonBuilder()
      .setCustomId(resolveRefreshId(current, slaveName, listPage))
      .setLabel(t('nav.refresh'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
  return new ActionRowBuilder().addComponents(buttons);
}

function navRows(current = 'main', slaveName = null, listPage = 0, guild = null) {
  if (!guildBridgeEnabled(guild)) {
    return [combinedNavRow(current, slaveName, listPage, guild)];
  }
  return [navTabRow(current, slaveName, listPage, guild)];
}

function combinedNavRow(current = 'main', slaveName = null, listPage = 0, guild = null) {
  const roomsNav = roomsNavExtra(listPage, slaveName);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('view', 'main', String(listPage)))
      .setLabel(t('nav.overview'))
      .setStyle(current === 'main' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('🏠'),
    new ButtonBuilder()
      .setCustomId(cid('view', 'master'))
      .setLabel(t('nav.master'))
      .setStyle(current === 'master' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('📢'),
    new ButtonBuilder()
      .setCustomId(cid('view', 'rooms', roomsNav))
      .setLabel(t('nav.rooms'))
      .setStyle(current === 'rooms' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('📍'),
    new ButtonBuilder()
      .setCustomId(cid('view', 'help'))
      .setLabel(t('nav.help'))
      .setStyle(current === 'help' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setEmoji('❓'),
    new ButtonBuilder()
      .setCustomId(resolveRefreshId(current, slaveName, listPage))
      .setLabel(t('nav.refresh'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
}

function slaveNavSelectRow(guild, slaves, context = 'main', page = 0) {
  const chunk = slavesOnNavPage(slaves, page);
  if (!chunk.length) return null;

  const pages = navPageCount(slaves.length);
  const options = chunk.map(s => {
    const bridge = s.solo ? 'Solo' : s.muted ? 'Muted' : `${s.volume}%`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(String(roomLabel(guild, s)).slice(0, 100))
      .setDescription(`#${s.name} · ${bridge} · ${actLabel(s.activity)}`.slice(0, 100))
      .setValue(String(s.name));
  });

  const start = page * LIST_PAGE_SIZE + 1;
  const end = start + chunk.length - 1;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('navslave', context, String(page)))
      .setPlaceholder(
        pages > 1
          ? t('mixer.channelsPage', { from: start, to: end, total: slaves.length })
          : t('mixer.channelsAll', { total: slaves.length }),
      )
      .addOptions(options),
  );
}

function muteSelectRow(guild, slaves, page = 0) {
  const chunk = slavesOnNavPage(slaves, page);
  if (!chunk.length) return null;

  const pages = navPageCount(slaves.length);
  const start = page * LIST_PAGE_SIZE + 1;
  const end = start + chunk.length - 1;

  const options = chunk.map(s => {
    return new StringSelectMenuOptionBuilder()
      .setLabel(String(roomLabel(guild, s)).slice(0, 100))
      .setDescription(`#${s.name} · ${s.muted ? t('slave.mutedSelect') : t('slave.liveSelect')}`.slice(0, 100))
      .setValue(String(s.name));
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('mutesel', 'mixer', String(page)))
      .setPlaceholder(
        pages > 1
          ? t('mixer.muteChannelPage', { from: start, to: end })
          : t('mixer.muteChannel'),
      )
      .addOptions(options),
  );
}

function soloSelectRow(guild, slaves, page = 0) {
  const chunk = slavesOnSoloPage(slaves, page);
  const solo = registry.getSoloSource(guild?.id);
  const pages = soloPageCount(slaves.length);

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel(t('mixer.soloOff'))
      .setValue('off')
      .setDefault(!solo),
  ];

  for (const s of chunk) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(t('mixer.soloLabel', { room: roomLabel(guild, s) }).slice(0, 100))
        .setDescription(t('mixer.soloOnly').slice(0, 100))
        .setValue(String(s.name))
        .setDefault(solo === String(s.name)),
    );
  }

  if (!chunk.length && page > 0) return null;

  const start = page * SOLO_ROOMS_PER_PAGE + 1;
  const end = chunk.length ? start + chunk.length - 1 : start;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('solosel', 'mixer', String(page)))
      .setPlaceholder(
        pages > 1
          ? solo
            ? t('mixer.soloActive', { room: slaveRoomLabel(guild, solo), from: start, to: end })
            : t('mixer.soloPick', { from: start, to: end })
          : solo
            ? t('mixer.soloActiveShort', { room: slaveRoomLabel(guild, solo) })
            : t('mixer.soloChoose'),
      )
      .addOptions(options),
  );
}

function slaveListPageRow(context, page, slaves, roomsBot = null) {
  const pages = panelPageCount(slaves);
  if (pages <= 1) return null;

  const suffix = roomsBot ? `~${roomsBot}` : '';
  const row = new ActionRowBuilder();
  if (page > 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('listpage', context, String(page - 1) + suffix))
        .setLabel(t('btn.prev'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(cid('listpage', context, 'x'))
      .setLabel(t('btn.page', { page: page + 1, pages }))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
  if (page < pages - 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('listpage', context, String(page + 1) + suffix))
        .setLabel(t('btn.next'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

function roomsBotSelectRow(guild, slaves, selectedKey, page = 0) {
  // The master option takes one of the 25 slots: page slaves by 24 (same as the page buttons).
  const chunk = slavesOnSoloPage(slaves, page);
  const pages = soloPageCount(slaves.length);
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel(String(botDisplayLabel(guild, 'master')).slice(0, 100))
      .setDescription(t('rooms.broadcastBot'))
      .setValue('master')
      .setDefault(selectedKey === 'master'),
  ];

  for (const s of chunk) {
    const status = s.pending
      ? t('common.offline')
      : isConnReady(s.connStatus)
        ? t('common.inVoice')
        : String(s.connStatus);
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(String(roomLabel(guild, s)).slice(0, 100))
        .setDescription(
          `${status} · chat ${channelLabel(guild, s.textChannelId)}`.replace(/\*\*/g, '').slice(0, 100),
        )
        .setValue(String(s.name))
        .setDefault(selectedKey === String(s.name)),
    );
  }

  const start = page * SOLO_ROOMS_PER_PAGE + 1;
  const end = chunk.length ? start + chunk.length - 1 : start;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid('navroom', String(page)))
      .setPlaceholder(
        pages > 1
          ? t('rooms.pickBotPage', { from: start, to: end, total: slaves.length })
          : t('rooms.pickBot'),
      )
      .addOptions(options),
  );
}

function roomsBotLabel(guild, botKey) {
  return botDisplayLabel(guild, botKey);
}

function roomsOfflineActionRow(slaves, selectedKey) {
  if (selectedKey === 'master') return null;
  const snap = slaves.find(s => s.name === String(selectedKey));
  if (!snap) return null;
  if (!snap.pending && isConnReady(snap.connStatus)) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('action', 'slave', `reconnect:${selectedKey}`))
      .setLabel(snap.pending ? t('rooms.startBot') : t('rooms.reconnectVoice'))
      .setStyle(ButtonStyle.Success)
      .setEmoji(snap.pending ? '▶️' : '🔗'),
  );
}

function buildRoomsRows(guild, slaves, selectedKey, page = 0) {
  const bridge = guildBridgeEnabled(guild);
  const slavesOn = guildSlavesEnabled(guild);
  const pickSlaves = bridge || slavesOn;
  const rows = [];
  const key = pickSlaves ? selectedKey : 'master';
  let offlineAction = null;
  if (pickSlaves) {
    rows.push(roomsBotSelectRow(guild, slaves, key, page));
    offlineAction = roomsOfflineActionRow(slaves, key);
  }
  const label = roomsBotLabel(guild, key);
  rows.push(voiceRoomSelectRow(key, t('rooms.voicePlaceholder', { label })));
  rows.push(textRoomSelectRow(key, t('rooms.chatPlaceholder', { label })));
  // A select fills its whole row: the reconnect action shares the page-arrow row instead,
  // keeping the view to 4 content rows.
  const pg = pickSlaves ? slaveListPageRow('rooms', page, slaves, key) : null;
  const buttons = new ActionRowBuilder();
  addJsonButtons(buttons, pg, offlineAction);
  if (buttons.components.length) rows.push(buttons);
  return rows;
}

function pauseToggleButton(botKey, paused) {
  const key = botKey === 'master' ? 'master' : String(botKey);
  const customId = key === 'master'
    ? cid('action', 'master', 'togglepause')
    : cid('action', 'slave', `togglepause:${key}`);
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(paused ? t('btn.resume') : t('btn.pause'))
    .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setEmoji(paused ? '▶️' : '⏸️');
}

function voteSkipToggleButton(botKey, guildId, enabled) {
  const key = botKey === 'master' ? 'master' : String(botKey);
  const customId = key === 'master'
    ? cid('action', 'master', 'togglevoteskip')
    : cid('action', 'slave', `togglevoteskip:${key}`);
  const on = enabled ?? getVoteToSkip(key, guildId);
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(on ? t('btn.voteSkipOn') : t('btn.voteSkipOff'))
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setEmoji(on ? '🗳️' : '⏭️');
}

function skipModeLabel(enabled) {
  return enabled ? t('common.skipVote') : t('common.skipInstant');
}

function bulkProfileActionsRow(guild, includeHelp = false) {
  const row = new ActionRowBuilder();
  if (panelShowsSlaves(guild)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('view', 'botedit', botEditNav(BULK_BOT_KEY, 'main')))
        .setLabel(t('btn.editAllBots'))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🖼️'),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(cid('view', 'perms'))
      .setLabel(t('perm.btn'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔐'),
  );
  if (includeHelp) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('view', 'help'))
        .setLabel(t('nav.help'))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❓'),
    );
  }
  const contact = contactLinkButton();
  if (contact) row.addComponents(contact);
  const dash = dashboardLinkButton(guild?.id);
  if (dash && row.components.length < 5) row.addComponents(dash);
  return row.components.length ? row : null;
}

function bulkPauseActionsRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('action', 'all', 'pause'))
      .setLabel(t('btn.pauseAll'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⏸️'),
    new ButtonBuilder()
      .setCustomId(cid('action', 'all', 'resume'))
      .setLabel(t('btn.resumeAll'))
      .setStyle(ButtonStyle.Success)
      .setEmoji('▶️'),
  );
}

function profileActionsRow(botKey, returnView = 'master') {
  const key = botKey === 'master' ? 'master' : String(botKey);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('view', 'botedit', botEditNav(key, returnView)))
      .setLabel(t('btn.editBot'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🖼️'),
  );
}

function masterActionsRow(guild) {
  const paused = registry.getMasterSnapshot(guild?.id)?.paused;
  const row = new ActionRowBuilder().addComponents(
    pauseToggleButton('master', paused),
    new ButtonBuilder()
      .setCustomId(cid('action', 'master', 'reconnect'))
      .setLabel(t('master.reconnect'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔗'),
    voteSkipToggleButton('master', guild?.id),
  );
  if (guildBridgeEnabled(guild)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('action', 'master', 'bridge'))
        .setLabel(t('master.restartBridge'))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔁'),
    );
  }
  return row;
}

function buildBotEditEmbed(guild, botKey, returnView = 'main') {
  if (botKey === BULK_BOT_KEY && returnView === 'remove') {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(t('botedit.removeTitle'))
      .setDescription(t('botedit.removeDesc'))
      .setFooter({ text: t('botedit.removeFooter') });
  }

  const title = botEditTitle(guild, botKey);
  let description = formatSummary(botKey, guild);
  if (botKey === BULK_BOT_KEY && guild?.id) {
    const st = getGuildBulkConnectionStatus(guild.id);
    if (st.total > 0 && !st.allConnected) {
      description += `\n\n${t('profile.bulk.connectNote', { connected: st.connected, total: st.total })}`;
    }
  }
  return new EmbedBuilder()
    .setColor(botKey === 'master'
      ? themeForMaster().color
      : botKey === BULK_BOT_KEY
        ? themeForMaster().color
        : themeForSlave(botKey, guild?.id).color)
    .setTitle(t('botedit.title', { title }))
    .setDescription(description)
    .setFooter({
      text: botKey === BULK_BOT_KEY ? t('botedit.footerBulk') : t('botedit.footerSingle'),
    });
}

function botRolesSelectRow(guild, botKey) {
  const { getAllowedRoleIds } = require('./chatAccess');
  const bulkRoleKey = firstSlaveBotKey(guild?.id);
  const defaults = botKey === BULK_BOT_KEY
    ? (getAllowedRoleIds(bulkRoleKey, guild?.id) || [])
    : (getAllowedRoleIds(botKey, guild?.id) || []);

  const menu = new RoleSelectMenuBuilder()
    .setCustomId(cid('roles', 'set', botKey))
    .setPlaceholder(
      botKey === BULK_BOT_KEY ? t('botedit.rolesBulk') : t('botedit.rolesSingle'),
    )
    .setMinValues(0)
    .setMaxValues(25);
  const existing = defaults.filter(id => !guild?.roles?.cache || guild.roles.cache.has(id));
  if (existing.length) menu.setDefaultRoles(...existing.slice(0, 25));

  return new ActionRowBuilder().addComponents(menu);
}

function buildRemoveBotOptions(guild) {
  const slaves = botStore.listSlaves(guild?.id);
  const snapshots = registry.getSlaveSnapshots(guild?.id);
  const snapByName = new Map(snapshots.map(s => [s.name, s]));
  return slaves.slice(0, LIST_PAGE_SIZE).map(entry => {
    const snap = snapByName.get(entry.name);
    const label = snap ? roomLabel(guild, snap) : `${t('common.slave')} #${entry.name}`;
    return new StringSelectMenuOptionBuilder()
      .setLabel(label.slice(0, 100))
      .setDescription(snap ? `#${entry.name} · ${t('common.online')}` : `#${entry.name} · ${t('common.notConnected')}`)
      .setValue(entry.name);
  });
}

function bulkBotManageRows(guild) {
  const slaves = botStore.listSlaves(guild?.id);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid('bot', 'add', 'bulk'))
        .setLabel(t('btn.addBot'))
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
      new ButtonBuilder()
        .setCustomId(cid('bot', 'remove', 'bulk'))
        .setLabel(t('btn.removeBot'))
        .setStyle(ButtonStyle.Danger)
        .setEmoji('⛔')
        .setDisabled(!slaves.length),
    ),
  ];
}

function bulkBotRemovePickRows(guild) {
  const options = buildRemoveBotOptions(guild);
  const rows = [];
  if (options.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid('bot', 'removepick', 'bulk'))
        .setPlaceholder(t('botedit.chooseRemove'))
        .addOptions(options),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('view', 'botedit', botEditNav(BULK_BOT_KEY, 'main')))
      .setLabel(t('common.cancel'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️'),
  ));
  return rows;
}

function buildBotEditRows(guild, botKey, returnView) {
  const key = String(botKey);
  if (key === BULK_BOT_KEY && returnView === 'remove') {
    return bulkBotRemovePickRows(guild);
  }

  const profileRow = new ActionRowBuilder();
  const showProfileEdit = key !== 'master' && guildSlaveProfileEditEnabled(guild);
  if (showProfileEdit) {
    profileRow.addComponents(
      new ButtonBuilder()
        .setCustomId(cid('profile', 'identity', key))
        .setLabel(t('btn.identity'))
        .setStyle(ButtonStyle.Primary)
        .setEmoji('👤'),
      new ButtonBuilder()
        .setCustomId(cid('profile', 'banner', key))
        .setLabel(t('btn.banner'))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎨'),
      new ButtonBuilder()
        .setCustomId(cid('profile', 'presence', key))
        .setLabel(t('btn.presence'))
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🎮'),
      new ButtonBuilder()
        .setCustomId(cid('profile', 'clear', key))
        .setLabel(key === BULK_BOT_KEY ? t('btn.clearAllSaved') : t('btn.clearSaved'))
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
    );
  }
  profileRow.addComponents(
    new ButtonBuilder()
      .setCustomId(cid('botedit', 'back', botEditNav(key, returnView)))
      .setLabel(t('common.back'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️'),
  );

  const rows = [profileRow];
  if (key === BULK_BOT_KEY && guildSlavesEnabled(guild)) rows.push(...bulkBotManageRows(guild));
  rows.push(botRolesSelectRow(guild, key));
  return rows;
}

function volumeSelectRow(slaveName, currentVol, placeholder, action = 'volsel') {
  const vol = Number(currentVol) || 100;
  const options = VOLUME_LEVELS.map(v => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(`${v}%`)
      .setValue(String(v))
      .setDefault(v === vol);
    if (v === 10) opt.setDescription(t('vol.quiet'));
    else if (v === 100) opt.setDescription(t('vol.normal'));
    else if (v === 200) opt.setDescription(t('vol.max'));
    return opt;
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(action, String(slaveName)))
      .setPlaceholder(String(placeholder || t('vol.placeholder', { vol })))
      .addOptions(options),
  );
}

function soloButton(slave, panel = 'mixer') {
  const n = String(slave.name);
  return new ButtonBuilder()
    .setCustomId(cid('solo', n, panel))
    .setLabel(slave.solo ? t('btn.soloOn') : t('btn.solo'))
    .setStyle(slave.solo ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setEmoji('🎧');
}

function slaveBridgeToggleButton(snap) {
  const name = String(snap?.name ?? '');
  if (snap?.colliding) {
    return new ButtonBuilder()
      .setCustomId(cid('bridge', 'collision', name))
      .setLabel(t('btn.bridgeCollision'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⛔')
      .setDisabled(true);
  }
  const on = snap?.bridgeEnabled !== false;
  return new ButtonBuilder()
    .setCustomId(cid('bridge', 'toggle', name))
    .setLabel(on ? t('btn.bridgeOn') : t('btn.bridgeOff'))
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary)
    .setEmoji(on ? '🔊' : '📴');
}

function slavePauseRow(guild, name) {
  const snap = registry.getSlaveSnapshots(guild?.id).find(s => s.name === String(name));
  const key = String(name);
  const row = new ActionRowBuilder().addComponents(
    pauseToggleButton(name, snap?.paused),
  );
  if (guildBridgeEnabled(guild)) {
    row.addComponents(slaveBridgeToggleButton(snap || { name }));
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(cid('view', 'botedit', botEditNav(key, 'slave')))
      .setLabel(t('btn.editBot'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🖼️'),
  );
  return row;
}

function slaveActionsRow(guild, name) {
  const snap = registry.getSlaveSnapshots(guild?.id).find(s => s.name === String(name));
  const offline = snap?.pending || !isConnReady(snap?.connStatus);
  if (!guildBridgeEnabled(guild)) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid('action', 'slave', `reconnect:${name}`))
        .setLabel(snap?.pending ? t('rooms.startBot') : t('btn.reconnect'))
        .setStyle(offline ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setEmoji(snap?.pending ? '▶️' : '🔗'),
    );
  }
  return new ActionRowBuilder().addComponents(
    soloButton(snap || { name, solo: false }, 'slave'),
    new ButtonBuilder()
      .setCustomId(cid('mute', name))
      .setLabel(t('btn.muteOnBridge'))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔇')
      .setDisabled(Boolean(snap?.pending)),
    new ButtonBuilder()
      .setCustomId(cid('action', 'slave', `reconnect:${name}`))
      .setLabel(snap?.pending ? t('rooms.startBot') : t('btn.reconnect'))
      .setStyle(offline ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji(snap?.pending ? '▶️' : '🔗'),
    new ButtonBuilder()
      .setCustomId(cid('music', name))
      .setLabel(t('btn.musicPanel'))
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎵'),
  );
}

function buildMainRows(guild, slaves, page = 0) {
  const rows = [];
  const nav = slaveNavSelectRow(guild, slaves, 'main', page);
  if (nav) rows.push(nav);
  const pg = slaveListPageRow('main', page, slaves);
  if (pg) rows.push(pg);
  return rows;
}

function jsonButton(component) {
  const btn = new ButtonBuilder()
    .setCustomId(component.custom_id)
    .setLabel(String(component.label ?? ''))
    .setStyle(component.style);
  if (component.emoji && (component.emoji.name || component.emoji.id)) {
    btn.setEmoji(component.emoji.name || String(component.emoji.id));
  }
  return component.disabled ? btn.setDisabled(true) : btn;
}

function addJsonButtons(row, ...sourceRows) {
  for (const src of sourceRows) {
    if (!src) continue;
    for (const c of src.toJSON().components) {
      if (c.type === 2) row.addComponents(jsonButton(c));
    }
  }
  return row;
}

function addJsonButtonArrows(row, ...sourceRows) {
  for (const src of sourceRows) {
    if (!src) continue;
    for (const c of src.toJSON().components) {
      if (c.type === 2 && !c.disabled) row.addComponents(jsonButton(c));
    }
  }
  return row;
}

function buildMixerRows(guild, slaves, page = 0, userMutePage = 0) {
  const rows = [mixerPresetsRow()];
  const solo = soloSelectRow(guild, slaves, page);
  if (solo) rows.push(solo);
  const mute = muteSelectRow(guild, slaves, page);
  if (mute) rows.push(mute);
  // Slave list and per-user mutes share one combined page row (each keeps its
  // existing button ids); the user-mute select lives in the slave view.
  const speakers = getBridgeSpeakers(guild);
  const combined = new ActionRowBuilder();
  addJsonButtonArrows(
    combined,
    slaveListPageRow('mixer', page, slaves),
    userMutePageRow(userMutePage, userMutePageCount(speakers.length), 'mixer'),
  );
  if (combined.components.length) rows.push(combined);
  return rows;
}

function buildSlaveRows(guild, slaveName, userMutePage = 0) {
  const bridge = guildBridgeEnabled(guild);
  const rows = [];
  let umPage = null;
  if (bridge) {
    const speakers = getBridgeSpeakers(guild, slaveName);
    const umSel = userMuteSelectRow(guild, 'slave', userMutePage, slaveName);
    if (umSel) rows.push(umSel);
    umPage = userMutePageRow(userMutePage, userMutePageCount(speakers.length), 'slave', slaveName);
  }
  const actions = slaveActionsRow(guild, slaveName);
  const pause = slavePauseRow(guild, slaveName);
  const a = actions.toJSON().components;
  const p = pause.toJSON().components;
  const umArrows = umPage ? umPage.toJSON().components.filter(c => c.type === 2) : [];
  if (a.length + p.length <= 5) {
    // Merge the pause toggle into the actions row when they fit side by side.
    const merged = new ActionRowBuilder();
    for (const c of [...a, ...p]) merged.addComponents(jsonButton(c));
    rows.push(merged);
    rows.push(voiceRoomSelectRow(slaveName, t('rooms.voicePlaceholder', { label: slaveRoomLabel(guild, slaveName) })));
    if (umArrows.length) rows.push(addJsonButtons(new ActionRowBuilder(), umPage));
  } else {
    // Over 5: keep the two rows; user-mute arrows join the pause row when they fit (a select fills its row).
    rows.push(actions);
    rows.push(p.length + umArrows.length <= 5 && umArrows.length ? addJsonButtons(pause, umPage) : pause);
    rows.push(voiceRoomSelectRow(slaveName, t('rooms.voicePlaceholder', { label: slaveRoomLabel(guild, slaveName) })));
  }
  return rows;
}

function masterRoomSelectPlaceholders(guild) {
  return {
    voice: `🔊 ${botDisplayLabel(guild, 'master')}`,
    chat: `💬 ${masterChatSelectLabel(guild)}`,
  };
}

function normalizePanelView(view, guild, slaveName) {
  const bridge = guildBridgeEnabled(guild);
  const slavesOn = guildSlavesEnabled(guild);
  if (!bridge) {
    if (view === 'mixer') return { view: 'main', slaveName: null };
    if (!slavesOn) {
      if (view === 'slave') return { view: 'main', slaveName: null };
      if (view === 'rooms' && slaveName && slaveName !== 'master') {
        return { view: 'rooms', slaveName: 'master' };
      }
      if (view === 'botedit' && slaveName) {
        const { botKey } = parseBotEditNav(slaveName);
        if (botKey !== 'master') {
          return { view: 'botedit', slaveName: botEditNav('master', 'master') };
        }
      }
    }
  }
  return { view, slaveName };
}

function buildPanel(view, guild, slaveName = null, listPage = 0, userMutePage = 0) {
  ({ view, slaveName } = normalizePanelView(view, guild, slaveName));
  const bridge = guildBridgeEnabled(guild);
  const slavesOn = guildSlavesEnabled(guild);
  const showSlaves = panelShowsSlaves(guild);
  const slaves = showSlaves ? registry.getSlaveSnapshots(guild?.id) : [];
  let embed;
  const components = [...navRows(view, slaveName, listPage, guild)];

  if (view === 'help') {
    embed = buildPanelHelpEmbed(guild);
  } else if (view === 'perms') {
    embed = buildPermsEmbed(guild);
    components.push(...buildPermsRows(guild));
  } else if (view === 'master') {
    embed = buildMasterEmbed(guild);
    components.push(masterActionsRow(guild));
    const masterRooms = masterRoomSelectPlaceholders(guild);
    components.push(voiceRoomSelectRow('master', masterRooms.voice));
    components.push(textRoomSelectRow('master', masterRooms.chat));
  } else if (view === 'mixer') {
    embed = buildMixerEmbed(guild);
    components.push(...buildMixerRows(guild, slaves, listPage, userMutePage));
  } else if (view === 'rooms') {
    const selectedKey = slaveName || 'master';
    embed = buildRoomsEmbed(guild);
    components.push(...buildRoomsRows(guild, slaves, selectedKey, listPage));
  } else if (view === 'botedit' && slaveName) {
    const { botKey, returnView } = parseBotEditNav(slaveName);
    if (botKey === 'master') {
      embed = buildMasterEmbed(guild);
      components.push(masterActionsRow(guild));
      const masterRooms = masterRoomSelectPlaceholders(guild);
      components.push(voiceRoomSelectRow('master', masterRooms.voice));
      components.push(textRoomSelectRow('master', masterRooms.chat));
    } else {
      embed = buildBotEditEmbed(guild, botKey, returnView);
      components.push(...buildBotEditRows(guild, botKey, returnView));
    }
  } else if (view === 'slave' && slaveName) {
    embed = buildSlaveEmbed(guild, slaveName);
    components.push(...buildSlaveRows(guild, slaveName, userMutePage));
  } else {
    embed = buildMainEmbed(guild);
    const profileRow = bulkProfileActionsRow(guild, bridge);
    if (profileRow) components.push(profileRow);
    components.push(bulkPauseActionsRow());
    if (bridge || slavesOn) {
      components.push(...buildMainRows(guild, slaves, listPage));
    }
  }

  // T81: hidden sections lose their buttons for server admins (view-only: disabled).
  const filtered = require('./panelSections').filterPayload({ embeds: [embed], components }, guild);
  if (filtered.components !== components) return filtered;
  if (components.length > 5) console.warn('[PANEL] rows dropped', view);
  return { embeds: [embed], components: components.slice(0, 5) };
}

function panelViewFromMessage(interaction) {
  const title = interaction.message?.embeds?.[0]?.title ?? '';
  if (title.includes('Room Assignments') || title.includes('تعيين الغرف')) return 'rooms';
  return null;
}

module.exports = {
  cid,
  parseBridgeId,
  parseListPage,
  parseRoomsNavExtra,
  parseBotEditNav,
  parseUserMuteNavExtra,
  botEditNav,
  panelViewFromMessage,
  buildPanel,
  themeForSlave,
  roomLabel,
  slaveRoomLabel,
};
