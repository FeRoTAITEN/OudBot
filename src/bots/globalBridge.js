const {
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const bridge = require('../bridge/bridge');
const { RelayStream } = require('../bridge/relayStream');
const { SILENCE_PADDING_FRAMES } = require('../bridge/audioConfig');
const registry = require('../bridge/registry');
require('../bridge/bridgeDiag');
const MusicManager = require('../music/MusicManager');
const { queueKeyForGuild } = require('../music/queueKey');
const { isGuildBridgeRuntime } = require('../config/mode');
const { createMusicPlayer, createBridgePlayer } = require('./voiceJoin');

function isRelayUsable(relay) {
  return Boolean(relay && !relay._stopped && !relay.readableEnded && !relay.destroyed);
}

function stopGuildBridge(entry, guildId) {
  const gid = String(guildId);
  if (entry?.bridgeRelay) {
    try { entry.bridgeRelay.stop(); } catch { /* ignore */ }
    entry.bridgeRelay = null;
  }
  bridge.setGuildRelay(gid, null);
  if (entry) entry.musicActive = false;
}

function stopAudioPlayer(player) {
  if (!player) return;
  try { player.stop(); } catch { /* ignore */ }
  player.removeAllListeners();
}

function playGuildBridge(entry, guildId, connection, attempt = 0) {
  if (!isGuildBridgeRuntime(guildId)) return;
  if (!entry || entry.musicActive) return;
  const gid = String(guildId);
  let relay = entry.bridgeRelay;
  if (!isRelayUsable(relay)) {
    try { relay?.stop(); } catch { /* ignore */ }
    relay = new RelayStream();
    relay.start();
    entry.bridgeRelay = relay;
    bridge.setGuildRelay(gid, relay);
    registry.clearBridgeSolo(gid);
  }

  const bridgePlayer = entry.bridgePlayer;
  if (!bridgePlayer || !connection) return;

  const status = bridgePlayer.state.status;
  if (status === AudioPlayerStatus.Playing || status === AudioPlayerStatus.Buffering) return;
  if (status === AudioPlayerStatus.Paused) {
    bridgePlayer.unpause();
    return;
  }

  try {
    connection.subscribe(bridgePlayer);
    bridgePlayer.play(createAudioResource(relay, {
      inputType: StreamType.Opus,
      silencePaddingFrames: SILENCE_PADDING_FRAMES,
    }));
  } catch (err) {
    console.error(`[GLOBAL:bridge:${gid}] play failed: ${err.message}`);
    try { relay?.stop(); } catch { /* ignore */ }
    entry.bridgeRelay = null;
    bridge.setGuildRelay(gid, null);
    if (attempt >= 10) {
      console.error(`[GLOBAL:bridge:${gid}] giving up after 10 play retries`);
      return;
    }
    setTimeout(() => {
      const live = require('./globalVoice').getEntry(gid);
      if (live !== entry || connection.state?.status === 'destroyed') return;
      playGuildBridge(entry, guildId, connection, attempt + 1);
    }, 400);
  }
}

function attachGuildBridge(guildId, connection, queueKey, entry, opts = {}) {
  if (!isGuildBridgeRuntime(guildId) || !connection || !entry) return false;

  const gid = String(guildId);
  stopAudioPlayer(entry.bridgePlayer);
  stopAudioPlayer(entry.musicPlayer);
  entry.bridgePlayer = null;
  stopGuildBridge(entry, gid);

  const bridgePlayer = createBridgePlayer();
  const musicPlayer = createMusicPlayer();

  entry.bridgePlayer = bridgePlayer;
  entry.musicPlayer = musicPlayer;
  entry.player = musicPlayer;
  entry.musicActive = false;

  MusicManager.rebindPlayer(queueKey, musicPlayer, connection);

  const queue = MusicManager.getQueue(queueKey);
  queue.onMusicStart = () => {
    if (!isGuildBridgeRuntime(gid)) return;
    entry.musicActive = true;
    if (entry.bridgeRelay) {
      try { entry.bridgeRelay.stop(); } catch { /* ignore */ }
      entry.bridgeRelay = null;
    }
    bridge.setGuildRelay(gid, null);
    connection.subscribe(musicPlayer);
  };
  queue.onQueueEmpty = () => {
    if (!isGuildBridgeRuntime(gid)) return;
    entry.musicActive = false;
    if (entry.bridgeRelay) {
      try { entry.bridgeRelay.stop(); } catch { /* ignore */ }
      entry.bridgeRelay = null;
    }
    playGuildBridge(entry, gid, connection);
  };

  bridgePlayer.on('stateChange', (_old, state) => {
    if (!isGuildBridgeRuntime(gid)) return;
    if (state.status === AudioPlayerStatus.Idle && !entry.musicActive) {
      playGuildBridge(entry, gid, connection);
    }
  });

  const deferPlayMs = Math.max(0, Number(opts.deferPlayMs) || 0);
  if (deferPlayMs > 0) {
    setTimeout(() => playGuildBridge(entry, gid, connection), deferPlayMs);
  } else {
    playGuildBridge(entry, gid, connection);
  }
  console.log(`[GLOBAL] Bridge relay active for guild ${gid}`);
  return true;
}

function restartGuildBridge(guildId) {
  const globalVoice = require('./globalVoice');
  const entry = globalVoice.getEntry(guildId);
  if (!entry?.connection) return false;
  stopGuildBridge(entry, guildId);
  playGuildBridge(entry, guildId, entry.connection);
  return true;
}

function detachGuildBridge(guildId, entry) {
  if (!entry) return false;
  const gid = String(guildId);
  stopGuildBridge(entry, gid);

  if (entry.bridgePlayer) {
    try { entry.bridgePlayer.stop(); } catch { /* ignore */ }
    entry.bridgePlayer.removeAllListeners();
    entry.bridgePlayer = null;
  }
  entry.musicActive = false;

  const player = entry.musicPlayer || entry.player;
  if (!player) return true;
  entry.player = player;

  const queueKey = queueKeyForGuild(gid);
  const queue = MusicManager.getQueue(queueKey);
  queue.onMusicStart = null;
  queue.onQueueEmpty = null;

  if (entry.connection) {
    try { entry.connection.subscribe(player); } catch { /* ignore */ }
    MusicManager.rebindPlayer(queueKey, player, entry.connection);
  }
  console.log(`[GLOBAL] Bridge relay stopped for guild ${gid}`);
  return true;
}

function reattachGuildBridge(guildId, opts = {}) {
  const globalVoice = require('./globalVoice');
  const entry = globalVoice.getEntry(guildId);
  if (!entry?.connection || !isGuildBridgeRuntime(guildId)) return false;
  const warmupMs = Math.max(0, Number(opts.warmupMs) || 400);
  return attachGuildBridge(
    guildId,
    entry.connection,
    queueKeyForGuild(guildId),
    entry,
    { deferPlayMs: warmupMs },
  );
}

function syncGuildBridgeRuntime(guildId) {
  const globalVoice = require('./globalVoice');
  const entry = globalVoice.getEntry(guildId);

  if (isGuildBridgeRuntime(guildId)) {
    if (entry?.connection) return reattachGuildBridge(guildId);
    return false;
  }
  return detachGuildBridge(guildId, entry);
}

module.exports = {
  attachGuildBridge,
  stopGuildBridge,
  detachGuildBridge,
  syncGuildBridgeRuntime,
  reattachGuildBridge,
  restartGuildBridge,
  playGuildBridge,
};
