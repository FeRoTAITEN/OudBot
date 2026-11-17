const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { extractVideoId, defaultThumbnail, displayTrackTitle } = require('./youtubeMeta');
const { detectLinkPlatform, platformLabel } = require('./linkMeta');
const { streamingPlatform, LABELS: STREAMING_LABELS } = require('./streamingLinks');
const { contactLinkButton } = require('../panel/contactLink');
const subscriptionStore = require('../subscription/subscriptionStore');
const { guildIdForQueueKey } = require('./musicStoragePath');
const { parseSlaveQueueKey } = require('./slaveQueueKey');
const { getEffectiveVoteToSkip, getSlaveVoteToSkipOverride } = require('../panel/musicSkipSettings');
const {
  getNpUiSize,
} = require('./npUiSettings');
const { t, getLang } = require('../i18n/context');
const { rtlBlock } = require('../i18n/rtl');
const { playCommand } = require('../i18n');
const { MAX_TRACKS: HISTORY_MAX } = require('./historyStore');

function cmd() {
  return playCommand(getLang());
}

const HISTORY_MENU_LIMIT = 25;

const SEARCH_RESULT_LIMIT = 10;
const TRACK_REMOVE_PAGE_SIZE = 25;

const MUSIC_VOLUME_LEVELS = [1, 2, 3, 4, 5];
for (let v = 10; v <= 200; v += 10) MUSIC_VOLUME_LEVELS.push(v);

const SLAVE_THEMES = {
  '1': { color: 0x5865f2, emoji: '🎧' },
  '2': { color: 0xeb459e, emoji: '🎤' },
  '3': { color: 0x57f287, emoji: '🎸' },
  default: { color: 0x5865f2, emoji: '🎵' },
};

const FILTER_ORDER = [
  'none', 'bass', 'treble',
  'eightd', 'wide', 'reverb',
  'phone', 'radio',
  'nightcore', 'vaporwave', 'slowed',
];

const AUTO_DJ_MOODS = [
  { id: 'lofi hip hop', key: 'lofi' },
  { id: 'chillhop beats', key: 'chillhop' },
  { id: 'jazz cafe', key: 'jazz' },
  { id: 'synthwave mix', key: 'synthwave' },
  { id: 'acoustic indie', key: 'acoustic' },
  { id: 'electronic dance', key: 'edm' },
  { id: 'rock classics', key: 'rock' },
  { id: 'pop hits', key: 'pop' },
];

function moodLabelFromId(moodId) {
  const preset = AUTO_DJ_MOODS.find(m => m.id === moodId);
  return preset ? t(`music.mood.${preset.key}`) : moodId;
}

const FILTER_PRESETS = {
  none: { filters: [], emoji: '🔊' },
  bass: { filters: ['bass=g=15:f=110:w=0.6'], emoji: '🎸' },
  treble: { filters: ['treble=g=12:f=5000'], emoji: '✨' },
  eightd: { filters: ['apulsator=mode=sine:amount=0.7:hz=0.45'], emoji: '🎧' },
  wide: { filters: ['extrastereo=m=2.2'], emoji: '🌍' },
  reverb: { filters: ['aecho=0.65:0.72:55:0.35'], emoji: '🏛️' },
  phone: { filters: ['highpass=f=300,lowpass=f=3400'], emoji: '📱' },
  radio: {
    filters: ['highpass=f=400,lowpass=f=3200,equalizer=f=1200:width_type=h:width=800:g=2'],
    emoji: '📻',
  },
  nightcore: { filters: ['aresample=48000,asetrate=48000*1.25'], emoji: '⚡' },
  vaporwave: { filters: ['aresample=48000,asetrate=48000*0.85'], emoji: '🌊' },
  slowed: {
    filters: ['aresample=48000,asetrate=38400,aresample=48000,aecho=0.8:0.88:90:0.4'],
    emoji: '🌙',
  },
};

function guildLabelForQueue(queueKey) {
  const guildId = guildIdForQueueKey(queueKey);
  if (!guildId) return null;
  const f = subscriptionStore.getGuildFeatures(guildId);
  return f.label || guildId;
}

function themeFor(queueKey) {
  const str = String(queueKey);
  if (str.startsWith('guild:')) {
    const label = guildLabelForQueue(str) || t('music.room.global');
    return {
      color: SLAVE_THEMES.default.color,
      emoji: '🎵',
      label,
    };
  }
  const m = str.match(/slave-\d+-(\d+)$/);
  let room = m?.[1];
  if (!room) {
    const legacy = str.match(/slave-(\d+)/);
    room = legacy?.[1];
  }
  const base = room && SLAVE_THEMES[room] ? SLAVE_THEMES[room] : SLAVE_THEMES.default;
  const label = room ? t(`music.room.${room}`) : t('music.room.default');
  return { ...base, label };
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '--:--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const PLATFORM_EMOJI = { youtube: '▶️', soundcloud: '☁️', bandcamp: '💿', mixcloud: '🎚️', external: '🔗' };

/** "▶️ YouTube", "☁️ SoundCloud", or "🎧 Spotify" for a streaming link matched on YouTube. */
function sourceBadge(track) {
  const via = track?.sourceUrl ? streamingPlatform(track.sourceUrl) : null;
  if (via) return `🎧 ${STREAMING_LABELS[via] || via}`;
  const p = detectLinkPlatform(track?.url);
  return p ? `${PLATFORM_EMOJI[p] || '🔗'} ${platformLabel(p)}` : null;
}

function shortTitle(track, max = 60) {
  const title = displayTrackTitle(track) || t('music.desc.track');
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

/**
 * Seconds until queue.tracks[index] starts (current remainder + tracks before it).
 * `unknown` counts tracks without a known length (live / not resolved yet).
 */
function secondsUntil(queue, index) {
  let sec = 0;
  let unknown = 0;
  const cur = queue.current;
  if (cur) {
    const total = cur.durationSec || 0;
    if (total) sec += Math.max(0, total - getTrackElapsed(cur, queue.player?.state?.status));
    else unknown++;
  }
  for (const tr of queue.tracks.slice(0, Math.max(0, index))) {
    if (tr.durationSec) sec += tr.durationSec;
    else unknown++;
  }
  return { sec, unknown };
}

/** Total time left: current remainder + everything waiting. */
function queueTimeLeft(queue) {
  return secondsUntil(queue, queue.tracks.length);
}

function timeText({ sec, unknown }) {
  if (!sec) return null;
  return `${formatDuration(sec)}${unknown ? '+' : ''}`;
}

/** "📋 5 in queue · ⏱️ 18:32 left" (null when nothing waits). */
function queueSummaryLine(queue) {
  const count = queue.tracks.length;
  if (!count) return null;
  const left = timeText(queueTimeLeft(queue));
  return left ? t('music.np.queueLine', { count, time: left }) : t('music.np.queueLineNoTime', { count });
}

/** Reply after adding one track: position in the queue and roughly when it plays. */
function addedQueueText(queue, title) {
  const idx = queue?.tracks ? queue.tracks.map(tr => tr.title).lastIndexOf(title) : -1;
  if (idx < 0) return t('mgr.addedQueue', { title });
  const wait = secondsUntil(queue, idx);
  const eta = !wait.unknown && wait.sec ? t('mgr.etaIn', { time: formatDuration(wait.sec) }) : '';
  return t('mgr.addedQueueAt', { title, pos: idx + 1, eta });
}

function nextUpLine(queue) {
  const next = queue.tracks[0];
  if (!next) return null;
  const dur = next.durationSec ? ` · \`${formatDuration(next.durationSec)}\`` : '';
  return `${shortTitle(next, 70)}${dur}`;
}

function getTrackElapsed(track, playerStatus) {
  if (!track) return 0;
  const base = track.startSec || 0;
  if (!track.startedAt) return base;
  if (playerStatus === 'paused' && track.pausedAt) {
    return base + (track.pausedAt - track.startedAt) / 1000;
  }
  return base + (Date.now() - track.startedAt) / 1000;
}

function progressBar(elapsed, total, size = 16) {
  if (!total || total <= 0) return '▱'.repeat(size);
  const ratio = Math.min(1, Math.max(0, elapsed / total));
  const filled = Math.round(ratio * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function loopLabel(mode) {
  if (mode === 'track') return t('music.loop.track');
  if (mode === 'queue') return t('music.loop.queue');
  return t('music.loop.off');
}

function filterLabel(key) {
  return t(`music.filter.${key}`);
}

function filterDesc(key) {
  return t(`music.filterDesc.${key}`);
}

/** Discord embed field values: 1..1024 chars. */
function fieldValue(text, fallback = '—') {
  const v = String(text ?? '').trim();
  if (!v) return fallback;
  return v.length > 1024 ? `${v.slice(0, 1021)}…` : v;
}

/** Mentions for a field, capped so a full voice room never exceeds the 1024-char field limit. */
function mentionList(ids, emptyText, max = 30) {
  if (!ids?.length) return emptyText;
  const shown = ids.slice(0, max).map(id => `<@${id}>`).join(' ');
  return fieldValue(ids.length > max ? `${shown} +${ids.length - max}` : shown);
}

function cid(queueKey, action, arg) {
  return arg ? `music:${queueKey}:${action}:${arg}` : `music:${queueKey}:${action}`;
}

function parseMusicId(customId) {
  if (!customId?.startsWith('music:')) return null;
  const rest = customId.slice(6);

  // guild:766294211233841204:action[:arg]
  const guild = rest.match(/^guild:(\d+):([^:]+)(?::(.*))?$/);
  if (guild) {
    return {
      queueKey: `guild:${guild[1]}`,
      action: guild[2],
      arg: guild[3] ?? null,
    };
  }

  // slave-766294211233841204-1:action[:arg]
  const slaveGuild = rest.match(/^slave-(\d+)-(\d+):([^:]+)(?::(.*))?$/);
  if (slaveGuild) {
    return {
      queueKey: `slave-${slaveGuild[1]}-${slaveGuild[2]}`,
      action: slaveGuild[3],
      arg: slaveGuild[4] ?? null,
    };
  }

  // master | slave-1 | other keys without colons
  const legacy = rest.match(/^([^:]+):([^:]+)(?::(.*))?$/);
  if (!legacy) return null;
  return {
    queueKey: legacy[1],
    action: legacy[2],
    arg: legacy[3] ?? null,
  };
}

function resolveQueueGuildId(queue, queueKey) {
  return queue.guild?.id || parseSlaveQueueKey(queueKey)?.guildId || guildIdForQueueKey(queueKey);
}

function npUiSizeLabel(size) {
  return t(`music.size.${size}`);
}

function buildStatsLine(queue) {
  return queue.djStats?.size
    ? [...queue.djStats.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([uid, n], i) => t('music.dj.plays', { medal: ['🥇', '🥈', '🥉'][i], uid, n }))
        .join('\n')
    : t('music.empty.stats');
}

function applyTrackArtwork(embed, track, size) {
  const thumb = track.thumbnail || defaultThumbnail(extractVideoId(track.url));
  if (!thumb) return;
  embed.setThumbnail(thumb);
  if (size === 'large') embed.setImage(thumb);
}

function buildNowPlayingFields(queue, queueKey, track, timeLine, size) {
  const fields = [
    { name: t('music.field.progress'), value: timeLine, inline: false },
  ];

  if (size === 'medium' || size === 'large') {
    fields.push(
      { name: t('music.field.requestedBy'), value: track.requester?.toString() ?? '—', inline: true },
      { name: t('music.field.loop'), value: loopLabel(queue.loop), inline: true },
    );
  }

  if (size === 'medium') {
    fields.push({ name: t('music.field.topDjs'), value: buildStatsLine(queue), inline: true });
  }

  const next = size === 'large' ? null : nextUpLine(queue);
  if (next) fields.push({ name: t('music.field.next'), value: fieldValue(next), inline: false });

  if (size === 'large') {
    const nextTracks = queue.tracks.slice(0, 5);
    const queuePreview = nextTracks.length
      ? nextTracks.map((tr, i) => {
        const dur = tr.durationSec ? ` · \`${formatDuration(tr.durationSec)}\`` : '';
        return `\`${i + 1}.\` ${shortTitle(tr, 48)}${dur}`;
      }).join('\n')
      : t('music.empty.queue');
    const listeners = mentionList(queue.listeners, t('music.empty.listeners'));
    const ownerLine = queue.roomOwnerId
      ? `<@${queue.roomOwnerId}>`
      : t('music.empty.none');

    fields.push(
      { name: t('music.field.volume'), value: `🔊 ${queue.volume ?? 100}%`, inline: true },
      { name: t('music.field.filter'), value: filterLabel(queue.activeFilter), inline: true },
      { name: t('music.field.roomOwner'), value: ownerLine, inline: true },
      { name: t('music.field.upNext', { count: queue.tracks.length }), value: queuePreview, inline: false },
      { name: t('music.field.inVoice'), value: listeners, inline: true },
      { name: t('music.field.topDjs'), value: buildStatsLine(queue), inline: true },
    );
  }

  return fields;
}

function buildNowPlayingEmbed(queue, queueKey) {
  const theme = themeFor(queueKey);
  const track = queue.current;
  if (!track) return null;

  const size = getNpUiSize(queueKey, resolveQueueGuildId(queue, queueKey));
  const elapsed = getTrackElapsed(track, queue.player?.state?.status);
  const total = track.durationSec || 0;
  const bar = progressBar(elapsed, total);
  // Unknown length (live stream / not resolved yet): elapsed time instead of an empty bar.
  const timeLine = total
    ? `\`${formatDuration(elapsed)}\` ${bar} \`${formatDuration(total)}\``
    : `\`${elapsed >= 1 ? formatDuration(elapsed) : '0:00'}\` · ${t('music.np.noLength')}`;
  const paused = queue.player?.state?.status === 'paused';
  const footerBits = [sourceBadge(track), queueSummaryLine(queue)].filter(Boolean);

  const embed = new EmbedBuilder()
    .setColor(theme.color)
    .setAuthor({
      name: t('music.np.author', { emoji: theme.emoji, label: theme.label }),
      iconURL: track.requester?.displayAvatarURL?.({ size: 64 }) ?? undefined,
    })
    .setTitle(paused ? t('music.np.paused') : t('music.np.playing'))
    .setDescription(`**[${displayTrackTitle(track)}](${track.url})**`)
    .addFields(...buildNowPlayingFields(queue, queueKey, track, timeLine, size))
    .setFooter({
      text: [
        ...footerBits,
        queue.autoDj?.enabled
          ? t('music.footer.autoDj', { query: queue.autoDj.query })
          : t('music.footer.default', { cmd: cmd() }),
      ].join(' · ').slice(0, 2048),
    })
    .setTimestamp();

  applyTrackArtwork(embed, track, size);
  return embed;
}

function buildFinishedFields(queue, track, timeLine, size) {
  const fields = [
    { name: t('music.field.progress'), value: timeLine, inline: false },
  ];

  if (size === 'medium' || size === 'large') {
    fields.push(
      { name: t('music.field.requestedBy'), value: track.requester?.toString() ?? '—', inline: true },
      { name: t('music.field.loop'), value: loopLabel(queue.loop), inline: true },
    );
  }

  if (size === 'medium') {
    fields.push({ name: t('music.field.topDjs'), value: buildStatsLine(queue), inline: true });
  }

  if (size === 'large') {
    const listeners = mentionList(queue.listeners, t('music.empty.listeners'));
    const ownerLine = queue.roomOwnerId
      ? `<@${queue.roomOwnerId}>`
      : t('music.empty.none');

    fields.push(
      { name: t('music.field.volume'), value: `🔊 ${queue.volume ?? 100}%`, inline: true },
      { name: t('music.field.filter'), value: filterLabel(queue.activeFilter), inline: true },
      { name: t('music.field.roomOwner'), value: ownerLine, inline: true },
      { name: t('music.field.upNext', { count: 0 }), value: t('music.empty.queue'), inline: false },
      { name: t('music.field.inVoice'), value: listeners, inline: true },
      { name: t('music.field.topDjs'), value: buildStatsLine(queue), inline: true },
    );
  }

  return fields;
}

function buildFinishedNowPlayingEmbed(queue, queueKey, track) {
  const theme = themeFor(queueKey);
  if (!track) return null;

  const size = getNpUiSize(queueKey, resolveQueueGuildId(queue, queueKey));
  const total = track.durationSec || 0;
  const bar = progressBar(total, total);
  const timeLine = `\`${formatDuration(total)}\` ${bar} \`${formatDuration(total)}\``;

  const embed = new EmbedBuilder()
    .setColor(theme.color)
    .setAuthor({
      name: t('music.np.authorFinished', { emoji: theme.emoji, label: theme.label }),
      iconURL: track.requester?.displayAvatarURL?.({ size: 64 }) ?? undefined,
    })
    .setTitle(t('music.np.finished'))
    .setDescription(`**[${displayTrackTitle(track)}](${track.url})**`)
    .addFields(...buildFinishedFields(queue, track, timeLine, size))
    .setFooter({ text: t('music.footer.finished', { cmd: cmd() }) })
    .setTimestamp();

  applyTrackArtwork(embed, track, size);
  return embed;
}

function buildFinishedControls(queueKey, track) {
  const videoId = extractVideoId(track?.url);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'replaylast', videoId || 'x'))
        .setEmoji('▶️')
        .setLabel(t('music.btn.playNow'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(!videoId),
    ),
  ];
}

function buildSearchEmbed(query, queueKey) {
  const theme = themeFor(queueKey);
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.search.title'))
    .setDescription(t('music.search.desc', { query }))
    .setFooter({ text: t('music.footer.search', { count: SEARCH_RESULT_LIMIT }) });
}

function buildHistoryEmbed(queue, queueKey) {
  const theme = themeFor(queueKey);
  const lines = queue.history?.length
    ? queue.history.slice(0, 15).map((t, i) => {
        const dur = t.durationSec ? ` · \`${formatDuration(t.durationSec)}\`` : '';
        return `\`${i + 1}.\` **[${t.title}](${t.url})**${dur}`;
      }).join('\n')
    : t('music.empty.history');

  const server = guildLabelForQueue(queueKey);
  const footer = server
    ? t('music.footer.historyGuild', { server, max: HISTORY_MAX, menu: HISTORY_MENU_LIMIT })
    : t('music.footer.history', { max: HISTORY_MAX, menu: HISTORY_MENU_LIMIT });

  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.history.title', { emoji: theme.emoji }))
    .setDescription(lines.slice(0, 4000))
    .setFooter({ text: footer });
}

/** Queue view page size: one select menu (25 options) per page. */
const QUEUE_PAGE_SIZE = 25;

function queuePageCount(queue) {
  return Math.max(1, Math.ceil(queue.tracks.length / QUEUE_PAGE_SIZE));
}

function clampQueuePage(queue, page) {
  const n = Number.parseInt(page, 10);
  return Math.min(Math.max(0, Number.isFinite(n) ? n : 0), queuePageCount(queue) - 1);
}

function buildQueueEmbed(queue, queueKey, page = 0) {
  const theme = themeFor(queueKey);
  const p = clampQueuePage(queue, page);
  const start = p * QUEUE_PAGE_SIZE;
  const pages = queuePageCount(queue);
  const waiting = queue.tracks.length;
  const bits = [];
  if (queue.current) bits.push(t('music.queue.playing'));
  if (waiting) bits.push(t('music.queue.waiting', { count: waiting }));
  const left = timeText(queueTimeLeft(queue));
  if (left) bits.push(t('music.queue.total', { time: left }));

  const lines = [];
  if (queue.current) {
    const title = (queue.current.title || t('music.desc.track')).slice(0, 80);
    lines.push(t('music.queue.now', { title }));
  }
  queue.tracks.slice(start, start + QUEUE_PAGE_SIZE).forEach((tr, i) => {
    const dur = tr.durationSec ? ` · \`${formatDuration(tr.durationSec)}\`` : '';
    const by = tr.requester?.id ? ` · <@${tr.requester.id}>` : '';
    lines.push(`\`${start + i + 1}.\` ${shortTitle(tr, 64)}${dur}${by}`);
  });

  const body = lines.length ? lines.join('\n') : t('music.empty.queueList');
  const header = bits.length ? `${bits.join(' · ')}\n\n` : '';

  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.queue.title', { emoji: theme.emoji }))
    .setDescription((header + body).slice(0, 4000))
    .setFooter({
      text: waiting
        ? `${t('music.footer.queueWait')}${pages > 1 ? ` · ${t('music.queue.page', { page: p + 1, pages })}` : ''}`
        : t('music.footer.queueEmpty'),
    });
}

function buildVideoOnlyRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'urlpick', 'video'))
      .setEmoji('▶️')
      .setLabel(t('music.btn.thisVideo'))
      .setStyle(ButtonStyle.Primary),
  );
}

function buildQueuePlayRow(queue, queueKey, page = 0) {
  const start = clampQueuePage(queue, page) * QUEUE_PAGE_SIZE;
  const slice = queue.tracks.slice(start, start + QUEUE_PAGE_SIZE);
  if (!slice.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'playqueue'))
      .setPlaceholder(t('music.ph.playNow'))
      .addOptions(
        slice.map((track, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${start + i + 1}. ${track.title || t('music.desc.track')}`.slice(0, 100))
            .setDescription(t('music.desc.playNow'))
            .setValue(String(start + i + 1)),
        ),
      ),
  );
}

function buildQueueMovePickRow(queue, queueKey, page = 0) {
  const start = clampQueuePage(queue, page) * QUEUE_PAGE_SIZE;
  const slice = queue.tracks.slice(start, start + QUEUE_PAGE_SIZE);
  if (!slice.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'movepick'))
      .setPlaceholder(t('music.ph.moveTrack'))
      .addOptions(
        slice.map((track, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${start + i + 1}. ${track.title || t('music.desc.track')}`.slice(0, 100))
            .setDescription(t('music.desc.moveThen'))
            .setValue(String(start + i + 1)),
        ),
      ),
  );
}

function buildQueueMoveButtonsRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'moveup'))
      .setEmoji('⬆️')
      .setLabel(t('music.btn.up'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'movedown'))
      .setEmoji('⬇️')
      .setLabel(t('music.btn.down'))
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildQueuePayload(queue, queueKey, page = 0) {
  const p = clampQueuePage(queue, page);
  const pages = queuePageCount(queue);
  const components = [];
  const playRow = buildQueuePlayRow(queue, queueKey, p);
  if (playRow) components.push(playRow);
  const movePick = buildQueueMovePickRow(queue, queueKey, p);
  if (movePick) {
    components.push(movePick);
    const moveRow = buildQueueMoveButtonsRow(queueKey);
    if (pages > 1) {
      moveRow.addComponents(
        new ButtonBuilder()
          .setCustomId(cid(queueKey, 'qpage', String(p - 1)))
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p === 0),
        new ButtonBuilder()
          .setCustomId(cid(queueKey, 'qpage', String(p + 1)))
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p >= pages - 1),
      );
    }
    components.push(moveRow);
  }
  return {
    embeds: [buildQueueEmbed(queue, queueKey, p)],
    components: components.slice(0, 5),
  };
}

/** Queue page that shows 1-based queue position `pos`. */
function queuePageFor(pos) {
  return Math.max(0, Math.floor((Number(pos) - 1) / QUEUE_PAGE_SIZE) || 0);
}

function buildHelpEmbed(queueKey) {
  const theme = themeFor(queueKey);
  const ar = getLang() === 'ar';
  const loc = (text) => (ar ? rtlBlock(text) : text);
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(loc(t('music.helpTitle', { emoji: theme.emoji })))
    .setDescription(loc(t('music.helpDesc')))
    .addFields(
      {
        name: loc(t('music.access')),
        value: loc(t('music.accessVal')),
        inline: false,
      },
      {
        name: loc(t('music.nowPlaying')),
        value: loc(t('music.nowPlayingVal')),
        inline: false,
      },
      {
        name: loc(t('music.textCmds')),
        value: loc(t('music.textCmdsVal')),
        inline: false,
      },
      {
        name: loc(t('music.menu')),
        value: loc(t('music.menuVal')),
        inline: false,
      },
      {
        name: loc(t('music.playlists')),
        value: loc(t('music.playlistsVal')),
        inline: false,
      },
      {
        name: loc(t('music.tips')),
        value: loc(t('music.tipsVal')),
        inline: false,
      },
    )
    .setFooter({ text: t('music.helpFooter', { label: theme.label }) });
}

function buildPlaylistHelpEmbed(queueKey) {
  const theme = themeFor(queueKey);
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.pl.title'))
    .setDescription(t('music.pl.desc', { cmd: cmd() }))
    .setFooter({ text: t('music.footer.playlistRoom', { label: theme.label }) });
}

function buildSavePreviewEmbed(queueKey, tracks, mode) {
  const theme = themeFor(queueKey);
  const embed = buildPlaylistHelpEmbed(queueKey);

  if (!tracks.length) {
    embed.addFields({
      name: t('music.pl.nothingSave'),
      value: t('music.pl.addFirst', { cmd: cmd() }),
    });
    return embed;
  }

  const label = mode === 'queue'
    ? t('music.pl.readyQueue', { count: tracks.length })
    : t('music.pl.readyNow');

  embed.addFields(
    { name: t('music.pl.ready'), value: label, inline: false },
    { name: t('music.pl.tracks'), value: formatTrackList(tracks), inline: false },
    { name: t('music.pl.nextStep'), value: t('music.pl.nextStepVal'), inline: false },
  );
  return embed;
}

function formatTrackList(tracks, max = 8) {
  if (!tracks?.length) return t('music.empty.tracks');
  const lines = tracks.slice(0, max).map((tr, i) => `\`${i + 1}.\` ${String(tr.title || t('music.desc.track')).slice(0, 100)}`);
  if (tracks.length > max) lines.push(t('music.queue.more', { count: tracks.length - max }));
  return fieldValue(lines.join('\n'));
}

function playlistPageCount(trackCount) {
  return Math.max(1, Math.ceil(trackCount / TRACK_REMOVE_PAGE_SIZE));
}

function clampPlaylistPage(trackCount, page) {
  const pages = playlistPageCount(trackCount);
  const n = Number.isFinite(Number(page)) ? Math.trunc(Number(page)) : 0;
  return Math.max(0, Math.min(n, pages - 1));
}

function pageForTrackIndex(index) {
  return Math.floor((index - 1) / TRACK_REMOVE_PAGE_SIZE);
}

function buildPlaylistDetailEmbed(queueKey, entry, page = 0) {
  const theme = themeFor(queueKey);
  const total = entry.tracks.length;
  const p = clampPlaylistPage(total, page);
  // Show the tracks of the selected page (was: always from track 1, whatever the page).
  const start = p * TRACK_REMOVE_PAGE_SIZE;
  const lines = entry.tracks.slice(start, start + TRACK_REMOVE_PAGE_SIZE)
    .map((tr, i) => `\`${start + i + 1}.\` ${String(tr.title || '').slice(0, 140)}`);
  const embed = new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(`📁 ${entry.displayName}`)
    .setDescription(lines.join('\n').slice(0, 4000) || t('music.empty.detail'));

  if (total > TRACK_REMOVE_PAGE_SIZE) {
    const from = p * TRACK_REMOVE_PAGE_SIZE + 1;
    const to = Math.min((p + 1) * TRACK_REMOVE_PAGE_SIZE, total);
    embed.setFooter({
      text: t('music.footer.playlistDetail', {
        from,
        to,
        total,
        page: p + 1,
        pages: playlistPageCount(total),
      }),
    });
  } else {
    embed.setFooter({ text: t('music.footer.removeTrack') });
  }
  return embed;
}

function buildSavedEmbed(queueKey, items, { historyCount = 0 } = {}) {
  const theme = themeFor(queueKey);
  const lines = [];
  if (historyCount) lines.push(t('music.pl.historyHint'));
  if (items.length) {
    lines.push(t('music.pl.listHint'));
  } else if (!historyCount) {
    lines.push(t('music.empty.playlist'));
  } else {
    lines.push(t('music.empty.playlistShort'));
  }

  const embed = new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.pl.savedTitle', { label: theme.label }))
    .setDescription(lines.join('\n'));

  for (const p of items.slice(0, 6)) {
    const preview = p.preview?.length
      ? p.preview.map((t, i) => `\`${i + 1}.\` ${String(t).slice(0, 80)}`).join('\n')
      : '—';
    embed.addFields({
      name: `${p.displayName} (${p.count})`.slice(0, 256),
      value: fieldValue(preview),
      inline: true,
    });
  }

  return embed;
}

function appendHistoryPreview(embed, history) {
  if (!history?.length) return embed;
  const preview = history.slice(0, 6).map((tr, i) => {
    const title = (tr.title || t('music.desc.track')).slice(0, 52);
    return `\`${i + 1}.\` ${title}${tr.title?.length > 52 ? '…' : ''}`;
  }).join('\n');
  embed.addFields({
    name: t('music.pl.recentHistory', { count: history.length }),
    value: preview + (history.length > 6 ? `\n${t('music.pl.moreHistory', { count: history.length - 6 })}` : ''),
    inline: false,
  });
  return embed;
}

function buildSaveSuccessEmbed(queueKey, displayName, count, tracks, mode) {
  const theme = themeFor(queueKey);
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(t('music.pl.savedOk', { name: displayName }))
    .setDescription(t('music.pl.savedDesc', { count, label: theme.label }))
    .addFields(
      {
        name: t('music.pl.savedFrom'),
        value: mode === 'queue' ? t('music.pl.fromQueue') : t('music.pl.fromNow'),
        inline: true,
      },
      { name: t('music.pl.tracks'), value: formatTrackList(tracks), inline: false },
      { name: t('music.pl.loadLater'), value: t('music.pl.loadLaterVal'), inline: false },
    );
}

function buildLoadSuccessEmbed(queueKey, entry, added, skipped) {
  const theme = themeFor(queueKey);
  const embed = new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.pl.loaded', { name: entry.displayName }))
    .setDescription(
      added.length
        ? t('music.pl.added', { count: added.length })
        : t('music.pl.allDup'),
    )
    .addFields({ name: t('music.pl.playlist'), value: formatTrackList(entry.tracks), inline: false });

  if (skipped) embed.addFields({ name: t('music.pl.skippedDup'), value: String(skipped), inline: true });
  return embed;
}

function buildVolumeRow(queue, queueKey) {
  const vol = queue.volume ?? 100;
  const options = MUSIC_VOLUME_LEVELS.map(v => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(`${v}%`)
      .setValue(String(v))
      .setDefault(v === vol);
    if (v === 100) opt.setDescription(t('music.vol.normal'));
    if (v === 5) opt.setDescription(t('music.vol.quiet'));
    if (v === 200) opt.setDescription(t('music.vol.max'));
    return opt;
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'volume'))
      .setPlaceholder(t('music.ph.volume', { vol }))
      .addOptions(options),
  );
}

function buildTransferSelectRow(queueKey, candidateIds, guild) {
  const options = candidateIds.slice(0, 25).map(id => {
    const member = guild?.members?.cache?.get(id);
    const label = (member?.displayName || member?.user?.username || 'User').slice(0, 100);
    return new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(id)
      .setDescription(t('music.desc.makeOwner'));
  });
  if (!options.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'transferpick'))
      .setPlaceholder(t('music.ph.transfer'))
      .addOptions(options),
  );
}

function buildFilterRow(queue, queueKey) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'filter'))
      .setPlaceholder(t('music.ph.filter'))
      .addOptions(
        ...FILTER_ORDER.map(value => {
          const p = FILTER_PRESETS[value];
          return new StringSelectMenuOptionBuilder()
            .setLabel(filterLabel(value))
            .setDescription(filterDesc(value) || p.emoji)
            .setValue(value)
            .setDefault(queue.activeFilter === value);
        }),
      ),
  );
}

function buildQueueRemoveRow(queue, queueKey) {
  const slice = queue.tracks.slice(0, 25);
  if (!slice.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'rmqueue'))
      .setPlaceholder(t('music.ph.removeQueue', { count: queue.tracks.length }))
      .addOptions(
        slice.map((track, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${i + 1}. ${track.title}`.slice(0, 100))
            .setDescription(t('music.desc.removeQueue'))
            .setValue(String(i + 1)),
        ),
      ),
  );
}

function buildHistoryPlayRow(queue, queueKey) {
  const slice = queue.history?.slice(0, HISTORY_MENU_LIMIT) || [];
  if (!slice.length) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'loadhist'))
      .setPlaceholder(t('music.ph.history'))
      .addOptions(
        slice.map((tr, i) => {
          const title = (tr.title || t('music.desc.track')).trim();
          const label = `${i + 1}. ${title}`.slice(0, 100);
          const desc = tr.durationSec ? formatDuration(tr.durationSec) : t('music.desc.replay');
          return new StringSelectMenuOptionBuilder()
            .setLabel(label || `${i + 1}. ${t('music.desc.track')}`)
            .setDescription(desc.slice(0, 100))
            .setValue(String(i));
        }),
      ),
  );
}

function buildLibraryRows(queue, savedPlaylists, queueKey) {
  const rows = [];
  const histRow = buildHistoryPlayRow(queue, queueKey);
  if (histRow) rows.push(histRow);
  if (savedPlaylists.length) rows.push(...buildPlaylistManagerRows(savedPlaylists, queueKey));
  return rows.slice(0, 5);
}

function buildLibraryPayload(queue, queueKey, savedPlaylists) {
  const history = queue.history ?? [];
  const embed = buildSavedEmbed(queueKey, savedPlaylists, { historyCount: history.length });
  appendHistoryPreview(embed, history);
  return {
    embeds: [embed],
    components: buildLibraryRows(queue, savedPlaylists, queueKey),
  };
}

function buildPlaylistLoadRow(savedPlaylists, queueKey) {
  if (!savedPlaylists.length) return null;
  const slice = savedPlaylists.slice(0, 25);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'loadpl'))
      .setPlaceholder(t('music.ph.loadPlaylist'))
      .addOptions(
        slice.map(p =>
          new StringSelectMenuOptionBuilder()
            .setLabel(p.displayName.slice(0, 100))
            .setDescription(t('music.desc.tracks', { count: p.count }))
            .setValue(p.key),
        ),
      ),
  );
}

function buildChooseEmbed(queueKey, { historyCount = 0, playlistCount = 0 } = {}) {
  const theme = themeFor(queueKey);
  const bits = [];
  if (historyCount) bits.push(`📜 ${historyCount}`);
  if (playlistCount) bits.push(`📂 ${playlistCount}`);
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.choose.title', { emoji: theme.emoji }))
    .setDescription(bits.length ? bits.join(' · ') : t('music.empty.pick'));
}

function buildChooseRows(queue, queueKey, savedPlaylists) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'playsearch'))
        .setEmoji('🔍')
        .setLabel(t('music.btn.searchSong'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'startautodj'))
        .setEmoji('🤖')
        .setLabel(queue.autoDj?.enabled ? t('music.btn.autoDjOn') : t('music.btn.autoDj'))
        .setStyle(queue.autoDj?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    buildAutoDjMoodRow(queue, queueKey),
  ];
  const histRow = buildHistoryPlayRow(queue, queueKey);
  if (histRow) {
    histRow.components[0].setPlaceholder(t('music.ph.historyShort'));
    rows.push(histRow);
  }
  const plRow = buildPlaylistLoadRow(savedPlaylists, queueKey);
  if (plRow) rows.push(plRow);
  return rows.slice(0, 5);
}

/** `p` alone — search, history, or load playlist (not playlist manager). */
function buildChoosePayload(queue, queueKey, savedPlaylists) {
  const history = queue.history ?? [];
  return {
    embeds: [buildChooseEmbed(queueKey, {
      historyCount: history.length,
      playlistCount: savedPlaylists.length,
    })],
    components: buildChooseRows(queue, queueKey, savedPlaylists),
  };
}

function buildUrlChoiceEmbed(videoTitle, playlistTitle, queueKey) {
  const theme = themeFor(queueKey);
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.url.title'))
    .setDescription(t('music.url.desc'))
    .addFields(
      { name: t('music.url.thisVideo'), value: videoTitle.slice(0, 256), inline: false },
      { name: t('music.url.fullPl'), value: playlistTitle.slice(0, 256), inline: false },
    );
}

function buildUrlChoiceRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'urlpick', 'video'))
      .setEmoji('▶️')
      .setLabel(t('music.btn.thisVideo'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'urlpick', 'playlist'))
      .setEmoji('📂')
      .setLabel(t('music.btn.fullPlaylist'))
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildStatsEmbed(queue, queueKey) {
  const theme = themeFor(queueKey);
  const entries = queue.djStats?.size
    ? [...queue.djStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    : [];
  const leaderboard = entries.length
    ? entries.map(([uid, n], i) => {
        const medal = ['🥇', '🥈', '🥉'][i] || `\`${i + 1}.\``;
        return t('music.stats.line', { medal, uid, n, s: n === 1 ? '' : 's' });
      }).join('\n')
    : t('music.empty.statsBoard');
  const total = entries.reduce((s, [, n]) => s + n, 0);

  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.stats.title', { emoji: theme.emoji, label: theme.label }))
    .setDescription(leaderboard)
    .setFooter({
      text: entries.length
        ? t('music.footer.stats', { djs: entries.length, total })
        : t('music.footer.statsReset'),
    });
}

function buildAutoDjMoodRow(queue, queueKey) {
  const mode = queue.autoDj?.mode === 'mood' ? 'mood' : 'similar';
  const current = queue.autoDj?.query || AUTO_DJ_MOODS[0].id;
  const currentMood = AUTO_DJ_MOODS.find(m => m.id === current);
  const currentLabel = mode === 'similar'
    ? t('music.mood.similar')
    : (currentMood ? t(`music.mood.${currentMood.key}`) : current);
  const similarOption = new StringSelectMenuOptionBuilder()
    .setLabel(t('music.mood.similar'))
    .setDescription(t('music.mood.similarDesc'))
    .setValue('__similar__')
    .setDefault(mode === 'similar');
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'autodjmood'))
      .setPlaceholder(t('music.ph.autoDj', { label: currentLabel }))
      .addOptions([
        similarOption,
        ...AUTO_DJ_MOODS.map(m =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t(`music.mood.${m.key}`))
            .setDescription(m.id)
            .setValue(m.id)
            .setDefault(mode === 'mood' && m.id === current),
        ),
      ]),
  );
}

function buildClearHistoryRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'clearhistask'))
      .setEmoji('🗑️')
      .setLabel(t('music.btn.clearHistory'))
      .setStyle(ButtonStyle.Danger),
  );
}

function buildHistoryPayload(queue, queueKey) {
  const components = [];
  const histRow = buildHistoryPlayRow(queue, queueKey);
  if (histRow) components.push(histRow);
  if (queue.history?.length) components.push(buildClearHistoryRow(queueKey));
  return {
    embeds: [buildHistoryEmbed(queue, queueKey)],
    components: components.slice(0, 5),
  };
}

function buildAutoDjEmbed(queue, queueKey) {
  const theme = themeFor(queueKey);
  const similar = queue.autoDj?.mode !== 'mood';
  const moodLabel = similar
    ? t('music.mood.similar')
    : moodLabelFromId(queue.autoDj?.query || AUTO_DJ_MOODS[0].id);
  const status = queue.autoDj?.enabled
    ? t('mgr.autoDjOn', { query: moodLabel })
    : t('mgr.autoDjOff');
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.autodj.title', { emoji: theme.emoji, label: theme.label }))
    .setDescription(t('music.autodj.desc', { status, mood: moodLabel }));
}

function buildAutoDjToggleButton(queue, queueKey) {
  const on = queue.autoDj?.enabled;
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'autodjtoggle'))
    .setEmoji('🤖')
    .setLabel(on ? t('music.btn.autoDjToggleOff') : t('music.btn.autoDjToggleOn'))
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildAutoDjPayload(queue, queueKey) {
  return {
    embeds: [buildAutoDjEmbed(queue, queueKey)],
    components: [
      buildAutoDjMoodRow(queue, queueKey),
      new ActionRowBuilder().addComponents(
        buildAutoDjToggleButton(queue, queueKey),
        buildMenuBackButton(queueKey),
      ),
    ],
  };
}

function buildClearHistoryConfirmRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'clearhistyes'))
      .setLabel(t('music.btn.yesClearHistory'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'clearhistno'))
      .setLabel(t('music.btn.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
}

function skipModeLabel(enabled) {
  return enabled ? t('common.skipVote') : t('common.skipInstant');
}

function buildSkipModeToggleButton(queueKey, guildId) {
  const slave = parseSlaveQueueKey(queueKey);
  if (!slave) return null;
  const gid = slave.guildId || guildId;
  if (!gid) return null;
  const on = getEffectiveVoteToSkip(slave.name, gid);
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'skipmodetoggle'))
    .setEmoji(on ? '🗳️' : '⏭️')
    .setLabel(skipModeLabel(on))
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildCompactMenuControlRows(queue, queueKey) {
  return [
    new ActionRowBuilder().addComponents(
      buildSeekBackButton(queueKey),
      buildSeekFwdButton(queueKey),
      buildShuffleButton(queueKey),
      buildLoopButton(queue, queueKey),
      buildControlsMoreButton(queueKey),
    ),
    buildVolumeRow(queue, queueKey),
  ];
}

function buildSkipModeSelectRow(queueKey, guildId) {
  const slave = parseSlaveQueueKey(queueKey);
  if (!slave) return null;
  const gid = slave.guildId || guildId;
  if (!gid) return null;
  const on = getEffectiveVoteToSkip(slave.name, gid);
  const override = getSlaveVoteToSkipOverride(slave.name, gid);
  const mode = skipModeLabel(on);
  const placeholder = override === null
    ? t('select.skipModeDefault', { mode })
    : t('select.skipMode', { mode });
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'skipmode'))
      .setPlaceholder(placeholder)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(t('btn.voteSkipOn'))
          .setDescription(t('select.skipVoteDesc'))
          .setValue('vote')
          .setEmoji('🗳️'),
        new StringSelectMenuOptionBuilder()
          .setLabel(t('btn.voteSkipOff'))
          .setDescription(t('select.skipInstantDesc'))
          .setValue('instant')
          .setEmoji('⏭️'),
      ),
  );
}

function buildMenuEmbed(queueKey, guildId = null) {
  const theme = themeFor(queueKey);
  let desc = t('music.menu.desc');
  if (parseSlaveQueueKey(queueKey)) {
    desc += `\n\n${t('music.menu.skipOwnerHint')}`;
  }
  desc += `\n\n${t('music.menu.uiSizeHint')}`;
  return new EmbedBuilder()
    .setColor(theme.color)
    .setTitle(t('music.menu.title', { emoji: theme.emoji, label: theme.label }))
    .setDescription(desc);
}

function buildUiSizeCycleButton(queueKey, guildId) {
  const size = getNpUiSize(queueKey, guildId);
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'npui'))
    .setEmoji('🖼️')
    .setLabel(t('music.btn.uiSize', { size: npUiSizeLabel(size) }))
    .setStyle(ButtonStyle.Success);
}

function buildControlsMoreButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'menucontrols'))
    .setEmoji('🎛️')
    .setLabel(t('music.btn.controlsMore'))
    .setStyle(ButtonStyle.Primary);
}

function buildMenuBackButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'menuback'))
    .setEmoji('⬅️')
    .setLabel(t('music.btn.menuBack'))
    .setStyle(ButtonStyle.Secondary);
}

function buildPauseButton(queue, queueKey) {
  const paused = queue.player?.state?.status === 'paused';
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'pause'))
    .setEmoji(paused ? '▶️' : '⏸️')
    .setLabel(paused ? t('music.btn.resume') : t('music.btn.pause'))
    .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary);
}

function buildSeekBackButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'seekback'))
    .setEmoji('⏪')
    .setLabel('-10s')
    .setStyle(ButtonStyle.Secondary);
}

function buildSeekFwdButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'seekfwd'))
    .setEmoji('⏩')
    .setLabel('+10s')
    .setStyle(ButtonStyle.Secondary);
}

function buildSkipButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'skip'))
    .setEmoji('⏭️')
    .setLabel(t('music.btn.skip'))
    .setStyle(ButtonStyle.Secondary);
}

function buildStopButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'stop'))
    .setEmoji('⏹️')
    .setLabel(t('music.btn.stop'))
    .setStyle(ButtonStyle.Danger);
}

function buildQueueButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'queue'))
    .setEmoji('📋')
    .setLabel(t('music.btn.queue'))
    .setStyle(ButtonStyle.Secondary);
}

function buildMenuButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'menu'))
    .setEmoji('⚙️')
    .setLabel(t('music.btn.menu'))
    .setStyle(ButtonStyle.Secondary);
}

function buildShuffleButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'shuffle'))
    .setEmoji('🔀')
    .setLabel(t('music.btn.shuffle'))
    .setStyle(ButtonStyle.Secondary);
}

function buildLoopButton(queue, queueKey) {
  const loop = queue.loop;
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'loop'))
    .setEmoji(loop === 'track' ? '🔂' : '🔁')
    .setLabel(loop === 'track' ? t('music.btn.loopTrack') : loop === 'queue' ? t('music.btn.loopQueue') : t('music.btn.loop'))
    .setStyle(loop === 'track' || loop === 'queue' ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildRestartButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'restart'))
    .setEmoji('🔃')
    .setLabel(t('music.btn.restart'))
    .setStyle(ButtonStyle.Secondary);
}

function buildTransferButton(queueKey) {
  return new ButtonBuilder()
    .setCustomId(cid(queueKey, 'transfer'))
    .setEmoji('👑')
    .setLabel(t('music.btn.transfer'))
    .setStyle(ButtonStyle.Primary);
}

function buildMenuPayload(queue, queueKey, savedPlaylists = []) {
  const gid = queue.guild?.id || parseSlaveQueueKey(queueKey)?.guildId || guildIdForQueueKey(queueKey);
  const npSize = getNpUiSize(queueKey, gid);
  const rows = [
    buildFilterRow(queue, queueKey),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'queue'))
        .setEmoji('📋')
        .setLabel(t('music.btn.queue'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'history'))
        .setEmoji('📜')
        .setLabel(t('music.btn.history'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'lyrics'))
        .setEmoji('📝')
        .setLabel(t('music.btn.lyrics'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'savepl'))
        .setEmoji('💾')
        .setLabel(t('music.btn.save'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'playlists'))
        .setEmoji('📂')
        .setLabel(t('music.btn.playlists'))
        .setStyle(ButtonStyle.Secondary),
    ),
    (() => {
      const extras = [
        buildUiSizeCycleButton(queueKey, gid),
        new ButtonBuilder()
          .setCustomId(cid(queueKey, 'autodj'))
          .setEmoji('🤖')
          .setLabel(queue.autoDj?.enabled ? t('music.btn.autoDjOn') : t('music.btn.autoDj'))
          .setStyle(queue.autoDj?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(cid(queueKey, 'stats'))
          .setEmoji('📊')
          .setLabel(t('music.btn.stats'))
          .setStyle(ButtonStyle.Secondary),
      ];
      const skipToggle = buildSkipModeToggleButton(queueKey, gid);
      if (skipToggle) extras.push(skipToggle);
      return new ActionRowBuilder().addComponents(...extras);
    })(),
  ];

  // Controls entry point (restart/transfer live on the controls sub-page).
  if (npSize === 'compact') {
    rows.push(...buildCompactMenuControlRows(queue, queueKey));
  } else {
    rows.push(new ActionRowBuilder().addComponents(buildControlsMoreButton(queueKey)));
  }

  return {
    embeds: [buildMenuEmbed(queueKey, gid)],
    components: rows,
  };
}

function buildControlsSubPagePayload(queue, queueKey) {
  const theme = themeFor(queueKey);
  const ownerRow = [buildRestartButton(queueKey)];
  if (queue.roomOwnerId) ownerRow.push(buildTransferButton(queueKey));
  const rows = [
    new ActionRowBuilder().addComponents(...ownerRow),
    new ActionRowBuilder().addComponents(buildMenuBackButton(queueKey)),
  ];

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(theme.color)
        .setTitle(t('music.menu.controlsTitle', { emoji: theme.emoji, label: theme.label }))
        .setDescription(t('music.menu.controlsDesc')),
    ],
    components: rows,
  };
}

function isMusicMenuMessage(interaction) {
  const title = interaction.message?.embeds?.[0]?.title ?? '';
  return title.includes('Music Menu')
    || title.includes('قائمة الموسيقى')
    || title.includes('Controls')
    || title.includes('تحكم')
    || title.includes('Auto-DJ')
    || title.includes('أوتو-DJ');
}

function appendContactRow(rows) {
  const contact = contactLinkButton();
  if (contact) rows.push(new ActionRowBuilder().addComponents(contact));
  return rows;
}

/** Main Now Playing — playback, volume, then menu / shuffle / loop / restart / transfer */
function buildControls(queue, queueKey, savedPlaylists = []) {
  const gid = resolveQueueGuildId(queue, queueKey);
  const size = getNpUiSize(queueKey, gid);
  const rows = [];

  if (size === 'compact') {
    rows.push(new ActionRowBuilder().addComponents(
      buildPauseButton(queue, queueKey),
      buildSkipButton(queueKey),
      buildStopButton(queueKey),
      buildQueueButton(queueKey),
      buildMenuButton(queueKey),
    ));
    return appendContactRow(rows);
  }

  rows.push(new ActionRowBuilder().addComponents(
    buildSeekBackButton(queueKey),
    buildPauseButton(queue, queueKey),
    buildSeekFwdButton(queueKey),
    buildSkipButton(queueKey),
    buildStopButton(queueKey),
  ));

  if (size === 'medium' || size === 'large') {
    rows.push(buildVolumeRow(queue, queueKey));
  }

  if (size === 'medium') {
    rows.push(new ActionRowBuilder().addComponents(
      buildMenuButton(queueKey),
      buildShuffleButton(queueKey),
      buildLoopButton(queue, queueKey),
    ));
    return appendContactRow(rows);
  }

  rows.push(new ActionRowBuilder().addComponents(
    buildMenuButton(queueKey),
    buildShuffleButton(queueKey),
    buildLoopButton(queue, queueKey),
    buildRestartButton(queueKey),
  ));

  return appendContactRow(rows);
}

function buildSearchSelect(videos, queueKey) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(cid(queueKey, 'pick'))
      .setPlaceholder(t('music.ph.pickTrack', { count: SEARCH_RESULT_LIMIT }))
      .addOptions(
        videos.slice(0, SEARCH_RESULT_LIMIT).map((v, i) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(v.title.slice(0, 100))
            .setDescription(v.duration?.timestamp ?? t('music.desc.unknownLen'))
            .setValue(String(i)),
        ),
      ),
  );
}

function buildPlayModal(queueKey) {
  return new ModalBuilder()
    .setCustomId(cid(queueKey, 'playmodal'))
    .setTitle(t('music.modal.searchPlay'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('play_query')
          .setLabel(t('music.modal.searchLabel'))
          .setPlaceholder(t('music.modal.searchPh'))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(200)
          .setRequired(true),
      ),
    );
}

function buildSaveModal(queueKey) {
  return new ModalBuilder()
    .setCustomId(cid(queueKey, 'savemodal'))
    .setTitle(t('music.modal.saveTitle'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('playlist_name')
          .setLabel(t('music.modal.saveLabel'))
          .setPlaceholder(t('music.modal.savePh'))
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(32)
          .setRequired(true),
      ),
    );
}

function buildPlaylistManagerRows(savedPlaylists, queueKey) {
  if (!savedPlaylists.length) return [];

  const rows = [];
  const slice = savedPlaylists.slice(0, 25);

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid(queueKey, 'loadpl'))
        .setPlaceholder(t('music.ph.loadPlaylistLong'))
        .addOptions(
          slice.map(p =>
            new StringSelectMenuOptionBuilder()
              .setLabel(p.displayName.slice(0, 100))
              .setDescription(t('music.desc.tracks', { count: p.count }))
              .setValue(p.key),
          ),
        ),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid(queueKey, 'editpl'))
        .setPlaceholder(t('music.ph.editPlaylist'))
        .addOptions(
          slice.map(p =>
            new StringSelectMenuOptionBuilder()
              .setLabel(p.displayName.slice(0, 100))
              .setDescription(t('music.desc.editTracks', { count: p.count }))
              .setValue(p.key),
          ),
        ),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid(queueKey, 'delpl'))
        .setPlaceholder(t('music.ph.deletePlaylist'))
        .addOptions(
          slice.map(p =>
            new StringSelectMenuOptionBuilder()
              .setLabel(t('music.desc.deletePrefix', { name: p.displayName }).slice(0, 100))
              .setDescription(t('music.desc.tracks', { count: p.count }))
              .setValue(p.key)
              .setEmoji('🗑️'),
          ),
        ),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(cid(queueKey, 'clearask'))
        .setLabel(t('music.btn.clearAllPlaylists'))
        .setEmoji('⚠️')
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}

function buildTrackRemoveComponents(queueKey, playlistKey, entry, page = 0) {
  if (!entry?.tracks?.length) return [];

  const total = entry.tracks.length;
  const pages = playlistPageCount(total);
  const p = clampPlaylistPage(total, page);
  const start = p * TRACK_REMOVE_PAGE_SIZE;
  const slice = entry.tracks.slice(start, start + TRACK_REMOVE_PAGE_SIZE);

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(cid(queueKey, 'rmtrack'))
        .setPlaceholder(
          t('music.ph.removeTrack', {
            name: entry.displayName,
            from: start + 1,
            to: start + slice.length,
            total,
          }),
        )
        .addOptions(
          slice.map((tr, i) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${start + i + 1}. ${tr.title}`.slice(0, 100))
              .setDescription(t('music.desc.clickDelete'))
              .setValue(`${playlistKey}|${start + i + 1}`),
          ),
        ),
    ),
  ];

  if (pages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(cid(queueKey, 'editpage', `${playlistKey}|${p - 1}`))
          .setLabel(t('music.btn.prev'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p === 0),
        new ButtonBuilder()
          .setCustomId(cid(queueKey, 'editpage', `${playlistKey}|${p + 1}`))
          .setLabel(t('music.btn.next'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p >= pages - 1),
      ),
    );
  }

  return rows;
}

function buildPlaylistEditPayload(queueKey, playlistKey, entry, page = 0) {
  const p = clampPlaylistPage(entry.tracks.length, page);
  return {
    embeds: [buildPlaylistDetailEmbed(queueKey, entry, p)],
    components: buildTrackRemoveComponents(queueKey, playlistKey, entry, p),
  };
}

function buildDeleteConfirmRow(queueKey, playlistKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'del_yes', playlistKey))
      .setLabel(t('music.btn.yesDelete'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'del_no'))
      .setLabel(t('music.btn.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** T70 (review M6): stopping a long queue asks first. */
const STOP_CONFIRM_OVER = 3;
function buildStopConfirmRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'stopyes'))
      .setLabel(t('music.btn.yesStop'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'stopno'))
      .setLabel(t('music.btn.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildClearConfirmRow(queueKey) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'clearyes'))
      .setLabel(t('music.btn.yesClearAll'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid(queueKey, 'clearno'))
      .setLabel(t('music.btn.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
}

module.exports = {
  buildStopConfirmRow,
  STOP_CONFIRM_OVER,
  AUTO_DJ_MOODS,
  FILTER_PRESETS,
  FILTER_ORDER,
  SEARCH_RESULT_LIMIT,
  themeFor,
  formatDuration,
  getTrackElapsed,
  sourceBadge,
  secondsUntil,
  queueTimeLeft,
  addedQueueText,
  queuePageFor,
  formatTrackList,
  buildNowPlayingEmbed,
  buildSearchEmbed,
  buildQueueEmbed,
  buildQueuePayload,
  buildQueuePlayRow,
  buildVideoOnlyRow,
  buildHistoryEmbed,
  buildHistoryPayload,
  buildStatsEmbed,
  buildAutoDjMoodRow,
  buildAutoDjPayload,
  buildClearHistoryRow,
  buildClearHistoryConfirmRow,
  buildTransferSelectRow,
  buildHelpEmbed,
  buildPlaylistHelpEmbed,
  buildSavePreviewEmbed,
  buildSavedEmbed,
  buildLibraryPayload,
  buildChoosePayload,
  buildUrlChoiceEmbed,
  buildUrlChoiceRow,
  buildLibraryRows,
  buildHistoryPlayRow,
  buildPlaylistDetailEmbed,
  buildSaveSuccessEmbed,
  buildLoadSuccessEmbed,
  buildControls,
  buildFinishedNowPlayingEmbed,
  buildFinishedControls,
  buildMenuPayload,
  buildControlsSubPagePayload,
  isMusicMenuMessage,
  npUiSizeLabel,
  buildFilterRow,
  buildQueueRemoveRow,
  buildVolumeRow,
  MUSIC_VOLUME_LEVELS,
  buildSearchSelect,
  buildPlayModal,
  buildSaveModal,
  buildPlaylistManagerRows,
  TRACK_REMOVE_PAGE_SIZE,
  buildTrackRemoveComponents,
  buildPlaylistEditPayload,
  pageForTrackIndex,
  buildDeleteConfirmRow,
  buildClearConfirmRow,
  parseMusicId,
  cid,
  filterLabel,
  moodLabelFromId,
};
