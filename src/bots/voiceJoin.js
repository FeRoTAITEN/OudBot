const {
  joinVoiceChannel,
  createAudioPlayer,
  entersState,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
} = require('@discordjs/voice');
const { logOnce } = require('../util/logger');

const VOICE_JOIN_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.VOICE_JOIN_MAX_ATTEMPTS || '3', 10) || 3,
);

const PLAYER_BEHAVIORS = {
  noSubscriber: NoSubscriberBehavior.Play,
  maxMissedFrames: 250,
};

function parseDecryptionFailureTolerance() {
  const raw = parseInt(process.env.VOICE_DECRYPTION_FAILURE_TOLERANCE || '1200', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 1200;
}

/** Shared joinVoiceChannel options — DAVE E2EE needs a high decrypt tolerance on receive. */
function withVoiceJoinOptions(options) {
  return {
    ...options,
    daveEncryption: true,
    decryptionFailureTolerance: parseDecryptionFailureTolerance(),
  };
}

/**
 * joinVoiceChannel + an 'error' listener: without one, transient voice WS failures
 * (Discord 521/522/503) surface as uncaughtException.
 */
function joinVoice(options, tag = '[VOICE]') {
  const connection = joinVoiceChannel(withVoiceJoinOptions(options));
  require('../web/listenHub').attach(connection);
  if (!connection.listenerCount('error')) {
    connection.on('error', (err) => {
      logOnce(`vcerr:${options.guildId}:${options.group || ''}:${err?.message}`, 60_000, () =>
        console.warn(`${tag} Voice connection error (${options.guildId}): ${err?.message || err}`));
    });
  }
  return connection;
}

function createMusicPlayer() {
  const player = createAudioPlayer({ behaviors: { ...PLAYER_BEHAVIORS } });
  player.on('error', (err) => {
    console.warn(`[VOICE] Audio player error: ${err?.message || err}`);
  });
  return player;
}

function createBridgePlayer() {
  return createMusicPlayer();
}

async function joinAndWaitReady(guild, channelId, group, { readyMs = 30_000 } = {}) {
  const connection = joinVoice({
    channelId,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    group,
    selfDeaf: false,
    selfMute: false,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, readyMs);
  return connection;
}

module.exports = {
  withVoiceJoinOptions,
  joinVoice,
  parseDecryptionFailureTolerance,
  createMusicPlayer,
  createBridgePlayer,
  joinAndWaitReady,
  VOICE_JOIN_MAX_ATTEMPTS,
  PLAYER_BEHAVIORS,
};
