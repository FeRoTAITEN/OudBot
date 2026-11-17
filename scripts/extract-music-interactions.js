const fs = require('fs');
const path = require('path');

const mgrPath = path.join(__dirname, '..', 'src', 'music', 'MusicManager.js');
const outPath = path.join(__dirname, '..', 'src', 'music', 'musicInteractions.js');
const src = fs.readFileSync(mgrPath, 'utf8');
const lines = src.split(/\r?\n/);
const start = lines.findIndex((l) => l.includes('static async handleInteraction'));
const end = lines.findIndex((l, i) => i > start && /^\s+static async showQueue/.test(l));
if (start < 0 || end < 0) {
  console.error('Could not find handleInteraction bounds', start, end);
  process.exit(1);
}
const body = lines.slice(start + 1, end - 1).map((l) => {
  let line = l.replace(/^\s{4}/, '');
  line = line.replace(/\bthis\./g, 'MusicManager.');
  return line;
});

const header = `const { t, getLang } = require('../i18n/context');
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
const { resolveTrackMetadata } = require('./youtubeMeta');
const {
  formatMusicError,
  formatMixPlaylistError,
  logMusicError,
  isUnknownInteraction,
} = require('./musicErrors');
const {
  buildMenuPayload,
  buildLoadSuccessEmbed,
  buildPlaylistEditPayload,
  buildPlaylistDetailEmbed,
  buildDeleteConfirmRow,
  buildClearConfirmRow,
  buildClearHistoryConfirmRow,
  buildHistoryEmbed,
  buildHistoryPlayRow,
  buildStatsEmbed,
  buildQueuePayload,
  buildTransferSelectRow,
  buildVideoOnlyRow,
  themeFor,
  filterLabel,
  moodLabelFromId,
  isMusicMenuMessage,
  formatDuration,
  pageForTrackIndex,
  TRACK_REMOVE_PAGE_SIZE,
  parseMusicId,
  musicQueueKeyMatches,
} = require('./musicUI');

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
`;

const footer = `
}

module.exports = { handleMusicInteraction };
`;

const transformed = body.join('\n')
  .replace(/\.catch\(\(\) => \{\}\)/g, '.catch(discordCatch(\'MUSIC\', \'interaction\'))');

fs.writeFileSync(outPath, header + transformed + footer);

const replacement = `  static async handleInteraction(interaction, queueKey, guild, getVoice) {
    const { handleMusicInteraction } = require('./musicInteractions');
    return handleMusicInteraction(interaction, queueKey, guild, getVoice);
  }

`;
const newMgr = [...lines.slice(0, start), replacement.trimEnd(), ...lines.slice(end)].join('\n');
fs.writeFileSync(mgrPath, newMgr);
console.log('Extracted', end - start, 'lines to musicInteractions.js');
