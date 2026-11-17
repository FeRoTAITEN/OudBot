// slave.js – Voice bridge + music per assigned channel
const { Client, GatewayIntentBits } = require('discord.js');
const {
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const bridge = require('../bridge/bridge');
const registry = require('../bridge/registry');
const { isSlaveBridgeBlocked } = require('../bridge/roomCollision');
const { isGuildBridgeRuntime } = require('../config/mode');
const MusicManager = require('../music/MusicManager');
const { attachMusicCommands } = require('../music/musicCommands');
const { createVoiceLocker } = require('./voiceGuard');
const { attachVoiceReady } = require('../util/voiceReady');
const { isOpusComfortNoise } = require('../bridge/opusFrames');
const { makeUserSourceKey } = require('../bridge/sourceKey');
const { OpusSplitter, packetMs } = require('../bridge/opusSplit');
const { JitterHub } = require('../bridge/jitterHub');
const {
  applyProfile,
} = require('../panel/botProfile');
const { safeListener } = require('../util/safeListener');
const { attachPresenceKeeper } = require('../panel/presenceKeeper');
const { joinVoice, createMusicPlayer, VOICE_JOIN_MAX_ATTEMPTS } = require('./voiceJoin');
const { discordRestOptions } = require('../util/discordClientOpts');
const { ensureGatewayInteractions } = require('./applicationBootstrap');
const { ensureSlaveVoiceRoom, applySlaveRoomToRuntime, forceSlaveToMasterVoiceFallback } = require('../panel/slaveRoomBootstrap');
const { slaveQueueKey, slaveRegistryKey } = require('../music/slaveQueueKey');

const startingSlaves = new Map();
const clientsByToken = new Map();
const startingByToken = new Map();
// T58c: a room bot that is on the Oud room while its own saved room exists goes back by itself.
const RETURN_HOME_MS = Math.max(
  60_000,
  parseInt(process.env.SLAVE_RETURN_HOME_MS || '300000', 10) || 300_000,
);
const SLAVE_RESYNC_GAP_MS = Math.max(
  0,
  parseInt(process.env.SLAVE_BRIDGE_RESYNC_GAP_MS || '100', 10) || 100,
);

/**
 * @param {object} cfg
 * @param {string} cfg.name
 * @param {string} cfg.token
 * @param {string} cfg.guildId
 * @param {string} cfg.channelId – voice channel this slave owns
 */
async function startSlave(cfg) {
  const regKey = slaveRegistryKey(cfg);
  const running = registry.state.slaves.get(regKey);
  if (running?.client) return running.client;

  if (startingSlaves.has(regKey)) return startingSlaves.get(regKey);

  const token = cfg.token?.trim();
  if (!token) throw new Error('Slave token is required');

  const task = (async () => {
    let client = clientsByToken.get(token);
    if (!client) {
      if (startingByToken.has(token)) {
        client = await startingByToken.get(token);
      } else {
        const loginTask = loginSharedSlaveClient(token);
        startingByToken.set(token, loginTask);
        try {
          client = await loginTask;
          clientsByToken.set(token, client);
        } finally {
          startingByToken.delete(token);
        }
      }
    }
    await attachSlaveDeployment(client, cfg);
    return client;
  })();

  startingSlaves.set(regKey, task);
  try {
    return await task;
  } finally {
    startingSlaves.delete(regKey);
  }
}

async function loginSharedSlaveClient(token) {
  const readyTimeoutMs = parseInt(process.env.SLAVE_READY_TIMEOUT_MS || '60000', 10) || 60000;
  const client = attachVoiceReady(new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    ...discordRestOptions(),
  }));

  client._slaveDeployments = new Map();
  client._pendingDeployments = [];

  let readyReject = () => {};
  const readyPromise = new Promise((resolve, reject) => {
    readyReject = reject;
    client.once('clientReady', async () => {
      console.log(`[SLAVE:POOL] Logged in as ${client.user.tag} (shared token)`);
      try {
        await ensureGatewayInteractions(client, '[SLAVE:POOL]');
      } catch (err) {
        console.warn(`[SLAVE:POOL] Gateway interactions failed: ${err.message}`);
      }
      for (const dep of client._pendingDeployments.splice(0)) {
        try {
          await finalizeSlaveDeployment(client, dep);
        } catch (err) {
          console.error(`[SLAVE:POOL] finalizing slave failed (${dep.tag}): ${err.stack || err.message}`);
        }
      }
      try {
        client.markVoiceReady?.();
      } finally {
        resolve();
      }
    });
  });

  client.on('error', (err) => {
    console.error('[SLAVE:POOL] Client error:', err.stack || err.message);
  });

  let readyTimer = null;
  try {
    await client.login(token);
    readyTimer = setTimeout(() => {
      readyReject(new Error(`Slave client not ready after ${readyTimeoutMs}ms`));
    }, readyTimeoutMs);
    await readyPromise;
  } catch (err) {
    try { client.destroy(); } catch { /* ignore */ }
    throw err;
  } finally {
    if (readyTimer) clearTimeout(readyTimer);
  }
  return client;
}

async function attachSlaveDeployment(client, cfg) {
  const regKey = slaveRegistryKey(cfg);
  if (registry.state.slaves.has(regKey)) return;

  const TAG = `[SLAVE:${cfg.name.toUpperCase()}]`;
  const queueKey = slaveQueueKey(cfg);

  const voice = createVoiceLocker({
    guildId: cfg.guildId,
    channelId: cfg.channelId,
    group: cfg.name,
    tag: TAG,
    onGiveUp: async () => {
      const guild = client.guilds.cache.get(cfg.guildId);
      if (!guild || !client.user) return;
      const resolved = await forceSlaveToMasterVoiceFallback(guild, cfg.name, 'rejoin gave up', {
        botUserId: client.user.id,
        tag: TAG,
      });
      applySlaveRoomToRuntime(client, cfg, voice, resolved);
      voice.scheduleRejoin('master fallback', { force: true });
    },
  });

  voice.setJoinFn(() => connectToChannel(client, cfg, TAG, voice, queueKey));

  const deployment = { regKey, cfg, queueKey, tag: TAG, voice };
  client._slaveDeployments.set(regKey, deployment);

  registry.registerSlave(regKey, client, cfg, {
    voice,
    reconnect: () => voice.scheduleRejoin('manual reconnect', { force: true }),
    promptReconnect: () => voice.promptRejoin('bridge refresh'),
    tag: TAG,
  });

  const { updateMusicRoom } = require('../music/musicCommands');
  updateMusicRoom(client, cfg.channelId, cfg.textChannelId, queueKey);

  if (!client._musicCommandsAttached) {
    attachMusicCommands(client, { sharedSlavePool: true });
  }

  if (client.user) {
    await finalizeSlaveDeployment(client, deployment);
  } else {
    client._pendingDeployments.push(deployment);
  }
}

async function finalizeSlaveDeployment(client, dep) {
  const { cfg, regKey, queueKey, tag: TAG, voice } = dep;

  await applyProfile(client, regKey, TAG, { presenceOnly: true }).catch(() => {});
  attachPresenceKeeper(client, regKey, TAG);

  if (!cfg.textChannelId) {
    console.warn(`${TAG} SLAVE_${cfg.name}_TEXT_CHANNEL_ID missing — music commands disabled`);
  }

  attachSlaveRoomGuard(client, dep);
  attachReturnHome(client, dep);

  if (voice.isPaused()) {
    // T60: paused before the restart — stay out of voice until someone resumes it.
    voice.attach(client);
    console.log(`${TAG} Voice paused (saved) — not joining until resumed`);
    return;
  }
  try {
    await joinWithRetry(voice, TAG);
    voice.arm();
    voice.attach(client);
  } catch (err) {
    console.error(`${TAG} Voice unavailable — bot online for panel; fix room or use Reconnect`);
  }
}

function attachSlaveRoomGuard(client, dep) {
  const { cfg, tag: TAG, voice } = dep;
  if (dep.roomGuardAttached || !isGuildBridgeRuntime(cfg.guildId)) return;
  dep.roomGuardAttached = true;

  dep.roomGuardHandler = safeListener(TAG, async (channel) => {
    if (!registry.state.slaves.has(dep.regKey)) return;
    if (channel.guild?.id !== cfg.guildId) return;
    const botConfigStore = require('../panel/botConfigStore');
    const { getMasterChannels } = require('../config/channels');
    // T58c: look up this guild's saved room (the default guild was used before, so deletes in
    // every other server went unnoticed and the bot kept retrying a dead room).
    const stored = botConfigStore.get(cfg.name, cfg.guildId);
    if (channel.id !== stored?.voiceChannelId && channel.id !== cfg.channelId) return;
    if (channel.id === getMasterChannels(cfg.guildId).voiceChannelId) return;

    console.warn(`${TAG} Voice room deleted — moving to Master room`);
    try {
      const guild = client.guilds.cache.get(cfg.guildId);
      if (!guild) return;
      const resolved = await ensureSlaveVoiceRoom(guild, cfg.name, {
        botUserId: client.user.id,
        tag: TAG,
      });
      applySlaveRoomToRuntime(client, cfg, voice, resolved);
      if (resolved.fellBackToMaster) {
        console.warn(`${TAG} On Master room — assign a separate room in panel when ready`);
      }
      if (!voice.isPaused()) voice.scheduleRejoin('room deleted');
    } catch (err) {
      console.error(`${TAG} Could not fall back to Master room:`, err.message);
    }
  });
  client.on('channelDelete', dep.roomGuardHandler);
}

/** True when this room bot runs away from its saved room (runtime fallback) and should go back. */
function awayFromHome(cfg) {
  const guildChannelsStore = require('../panel/guildChannelsStore');
  const { getMasterChannels } = require('../config/channels');
  const saved = guildChannelsStore.getSlave(cfg.guildId, cfg.name)?.voiceChannelId?.trim();
  if (!saved || saved === cfg.channelId) return null;
  if (saved === getMasterChannels(cfg.guildId).voiceChannelId) return null;
  return saved;
}

function attachReturnHome(client, dep) {
  const { cfg, tag: TAG, voice } = dep;
  if (dep.returnHomeTimer) return;
  dep.returnHomeTimer = setInterval(() => {
    if (!registry.state.slaves.has(dep.regKey) || voice.isPaused() || voice.isJoining()) return;
    const saved = awayFromHome(cfg);
    if (!saved) return;
    console.log(`${TAG} Own room ${saved} saved but bot is on ${cfg.channelId} — going back`);
    voice.scheduleRejoin('return home', { force: true });
  }, RETURN_HOME_MS);
  dep.returnHomeTimer.unref?.();
}

function getSlaveRegistryEntry(cfg) {
  return registry.state.slaves.get(slaveRegistryKey(cfg));
}

function countDeploymentsForClient(client) {
  let n = 0;
  for (const entry of registry.state.slaves.values()) {
    if (entry.client === client) n += 1;
  }
  return n;
}

async function teardownSlaveDeployment(regKey) {
  const entry = registry.state.slaves.get(String(regKey));
  if (!entry?.client) return false;

  const { client, cfg, voice } = entry;
  const token = cfg?.token?.trim();
  const gid = cfg?.guildId;
  const name = cfg?.name;

  await MusicManager.haltGuildPlayback(slaveQueueKey(cfg)).catch(() => {});

  entry._bridgeReceiverCleanup?.();
  entry._bridgeReceiverCleanup = null;
  if (gid && name) registry.setSlaveMusicActive(gid, name, false);
  entry.jitterHub = null;
  entry.bridgeResyncUsers = null;
  entry.bridgeReceiverCtx = null;

  if (gid && name) {
    try { getVoiceConnection(gid, name)?.destroy(); } catch { /* ignore */ }
  }

  voice?.destroy?.();
  const dep = client._slaveDeployments?.get(String(regKey));
  if (dep?.roomGuardHandler) {
    try { client.off('channelDelete', dep.roomGuardHandler); } catch { /* ignore */ }
  }
  if (dep?.returnHomeTimer) clearInterval(dep.returnHomeTimer);
  client._slaveDeployments?.delete(String(regKey));
  registry.unregisterSlave(String(regKey));

  if (countDeploymentsForClient(client) === 0) {
    if (token) clientsByToken.delete(token);
    try { client.destroy(); } catch { /* ignore */ }
  }
  return true;
}

const VOICE_JOIN_MAX_ATTEMPTS_LOCAL = VOICE_JOIN_MAX_ATTEMPTS;

async function joinWithRetry(voice, TAG, attempt = 1) {
  try {
    await voice.runJoin();
  } catch (err) {
    if (attempt >= VOICE_JOIN_MAX_ATTEMPTS_LOCAL) {
      console.error(`${TAG} Voice join failed after ${attempt} attempt(s):`, err.message);
      throw err;
    }
    const aborted = /aborted/i.test(err.message);
    if (aborted) {
      console.log(`${TAG} Voice join retrying (${attempt}/${VOICE_JOIN_MAX_ATTEMPTS_LOCAL})…`);
    } else {
      console.error(`${TAG} Join attempt ${attempt} failed:`, err.message);
    }
    const delay = Math.min(attempt * 3000, 15_000);
    await new Promise(r => setTimeout(r, delay));
    await joinWithRetry(voice, TAG, attempt + 1);
  }
}

async function connectToChannel(client, cfg, TAG, voice, queueKey) {
  const entry = getSlaveRegistryEntry(cfg);
  const guild = client.guilds.cache.get(cfg.guildId);
  if (!guild) {
    const hint = client.guilds.cache.size
      ? ` Bot is in ${client.guilds.cache.size} server(s) — check GUILD_ID or invite the bot.`
      : ' Bot is not in any server — invite it with the correct GUILD_ID.';
    throw new Error(`Guild not found (${cfg.guildId}).${hint}`);
  }

  let resolved = await ensureSlaveVoiceRoom(guild, cfg.name, {
    botUserId: client.user.id,
    tag: TAG,
  });
  applySlaveRoomToRuntime(client, cfg, voice, resolved);
  if (resolved.fellBackToMaster) {
    console.warn(`${TAG} On Master room — voice only, chat silent, bridge capture off`);
  }

  const runJoinAttempt = async () => {
    const existing = getVoiceConnection(cfg.guildId, cfg.name);
    if (existing) {
      existing.destroy();
      await new Promise(r => setTimeout(r, 400));
    }

    const connection = joinVoice({
      channelId: cfg.channelId,
      guildId: cfg.guildId,
      adapterCreator: guild.voiceAdapterCreator,
      group: cfg.name,
      selfDeaf: false,
      selfMute: false,
    }, TAG);

    const player = createMusicPlayer();
    connection.subscribe(player);
    if (entry) {
      entry.player = player;
      entry.connection = connection;
    }
    MusicManager.rebindPlayer(queueKey, player, connection);

    player.on('error', (err) =>
      console.error(`${TAG} Player error:`, err.message),
    );

    let isReady = false;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!isReady) return;
      console.log(`${TAG} Left voice room — trying to resume...`);
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        console.log(`${TAG} Back in voice room`);
        MusicManager.ensureVoicePlayback(MusicManager.getQueue(queueKey));
        await client._refreshPresence?.('voice-resume');
      } catch {
        console.log(`${TAG} Resume failed — rejoining...`);
        voice.scheduleRejoin('voice disconnected');
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (err) {
      console.warn(`${TAG} Join stuck in '${connection.state.status}' — resetting connection`);
      try { connection.destroy(); } catch { /* ignore */ }
      throw err;
    }
    isReady = true;
    console.log(`${TAG} Joined voice channel ${cfg.channelId}`);

    await client._refreshPresence?.('voice-join');

    const colliding = isGuildBridgeRuntime(cfg.guildId) && isSlaveBridgeBlocked(cfg.channelId, cfg.guildId);
    if (colliding) {
      stopMusicIfPlaying(entry, queueKey, TAG);
      console.log(`${TAG} Same room as Master — bridge capture & music disabled`);
    }

    const queue = MusicManager.getQueue(queueKey);
    if (isGuildBridgeRuntime(cfg.guildId) && !colliding) {
      setupReceiver(client, connection, cfg, TAG, entry);
      bindSlaveBridgeQueueResync(entry, cfg, queue);
    } else {
      queue.onBridgeResync = null;
      hookBridgeMusicPlayer(entry, (_old, state) => {
        registry.setSlaveMusicActive(
          cfg.guildId,
          cfg.name,
          state.status === AudioPlayerStatus.Playing,
        );
      });
    }
  };

  try {
    await runJoinAttempt();
  } catch (firstErr) {
    // T56: one more try on the own room before falling back (joins fail on transient UDP loss).
    if (!resolved.fellBackToMaster) {
      await new Promise(r => setTimeout(r, 3000));
      try { await runJoinAttempt(); return; } catch { /* fall through */ }
    }
    if (!resolved.fellBackToMaster && isGuildBridgeRuntime(cfg.guildId)) {
      console.warn(`${TAG} Voice join failed (${firstErr.message}) — Master room fallback`);
      resolved = await forceSlaveToMasterVoiceFallback(guild, cfg.name, firstErr.message, {
        botUserId: client.user.id,
        tag: TAG,
      });
      applySlaveRoomToRuntime(client, cfg, voice, resolved);
      await runJoinAttempt();
    } else {
      throw firstErr;
    }
  }
}

function isMusicPlaying(entry) {
  return entry?.player?.state?.status === AudioPlayerStatus.Playing;
}

function stopMusicIfPlaying(entry, queueKey, TAG) {
  const queue = MusicManager.getQueue(queueKey);
  if (!queue?.current) return;
  try {
    queue.skipIdleOnce = true;
    entry?.player?.stop();
    console.log(`${TAG} Stopped music — Master room collision`);
  } catch { /* ignore */ }
}

function ensureBridgeVoiceStateHandler(client) {
  if (client._bridgeVoiceStateHandler) return;
  client._bridgeVoiceStateHandler = safeListener('[SLAVE:POOL]', (oldState, newState) => {
    for (const e of registry.state.slaves.values()) {
      if (e.client !== client) continue;
      const ctx = e.bridgeReceiverCtx;
      if (!ctx) continue;
      const { cfg: roomCfg, botUserId: botId, subscribeUser: sub, unsubscribeUser: unsub } = ctx;
      const guildId = newState.guild?.id ?? oldState.guild?.id;
      if (guildId !== roomCfg.guildId) continue;
      if (newState.id === botId) continue;
      const wasIn = oldState.channelId === roomCfg.channelId;
      const nowIn = newState.channelId === roomCfg.channelId;
      if (nowIn && !wasIn) sub(newState.id);
      if (wasIn && !nowIn) unsub?.(newState.id);
    }
  });
  client.on('voiceStateUpdate', client._bridgeVoiceStateHandler);
}

function setupReceiver(client, connection, cfg, TAG, entry) {
  if (connection._bridgeReceiverSetup) return;
  connection._bridgeReceiverSetup = true;

  let closed = false;
  const retryTimers = new Set();

  const { receiver } = connection;
  const botUserId = client.user.id;
  const slaveName = cfg.name;
  const guildId = cfg.guildId;
  const users = new Map();
  const resubscribeAttempts = new Map();
  // T42f: count RTP sequence gaps (network loss) and packets dropped by decryption, per subscribed user.
  if (!receiver._diagParse) {
    const origParse = receiver.parsePacket.bind(receiver);
    const lastSeq = new Map();
    receiver._diagParse = true;
    receiver.parsePacket = (buffer, mode, nonce, key, uid) => {
      const d = entry.diag;
      d.udp++;
      const seq = buffer.readUInt16BE(2);
      const last = lastSeq.get(uid);
      if (last !== undefined) {
        const gap = (seq - last - 1) & 0xffff;
        if (gap > 0 && gap < 500) d.lost += gap;
      }
      lastSeq.set(uid, seq);
      let p;
      try { p = origParse(buffer, mode, nonce, key, uid); } catch (e) { d.bad++; throw e; }
      if (!p) d.drop++;
      return p;
    };
  }
  entry.diag = { rx: 0, out: 0, cn: 0, err: 0, long: 0, short: 0, udp: 0, lost: 0, drop: 0, bad: 0, users };

  const hub = new JitterHub((frame, sourceKey) => {
    entry.diag.out++;
    bridge.emit('audio', frame, sourceKey);
  });
  hub.setMusicActive(isMusicPlaying(entry));
  registry.setSlaveMusicActive(guildId, slaveName, isMusicPlaying(entry));
  entry.jitterHub = hub;

  const subscribeUser = (userId) => {
    if (closed) return;
    if (userId === botUserId) return;
    const existing = users.get(userId);
    if (existing && !existing.destroyed) return;
    if (existing) users.delete(userId);

    const sourceKey = makeUserSourceKey(slaveName, userId, guildId);
    const splitter = new OpusSplitter();
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.Manual },
    });
    users.set(userId, opusStream);

    opusStream.on('data', (frame) => {
      if (!frame?.length) return;
      entry.diag.rx++;
      if (isOpusComfortNoise(frame)) {
        entry.diag.cn++;
        hub.touch(sourceKey);
        bridge.emit('audio', frame, sourceKey);
        return;
      }
      resubscribeAttempts.set(userId, 0);
      const ms = packetMs(frame);
      if (ms > 20) entry.diag.long++;
      else if (ms > 0 && ms < 20) entry.diag.short++;
      for (const f of splitter.split(frame)) hub.push(sourceKey, f);
    });

    opusStream.once('close', () => users.delete(userId));
    opusStream.on('error', (err) => {
      entry.diag.err++;
      const attempt = (resubscribeAttempts.get(userId) ?? 0) + 1;
      resubscribeAttempts.set(userId, attempt);
      console.warn(`${TAG} opusStream error (${userId}, try ${attempt}):`, err.message);
      users.delete(userId);
      try { opusStream.destroy(); } catch { /* ignore */ }
      if (attempt <= 10) {
        const delay = 400 + attempt * 400;
        const t = setTimeout(() => {
          retryTimers.delete(t);
          // Do not resubscribe someone who left the room meanwhile.
          const vs = client.guilds.cache.get(guildId)?.voiceStates.cache.get(userId);
          if (vs && vs.channelId !== cfg.channelId) return;
          subscribeUser(userId);
        }, delay);
        retryTimers.add(t);
      } else {
        console.error(`${TAG} Stopped receiving from ${userId} after repeated decrypt errors`);
      }
    });
  };

  const unsubscribeUser = (userId) => {
    const stream = users.get(userId);
    users.delete(userId);
    resubscribeAttempts.delete(userId);
    if (stream) {
      try { stream.destroy(); } catch { /* ignore */ }
    }
    hub.forget(makeUserSourceKey(slaveName, userId, guildId));
  };

  const syncChannel = () => {
    for (const [, vs] of client.guilds.cache.get(guildId)?.voiceStates.cache ?? []) {
      if (vs.channelId === cfg.channelId && vs.id !== botUserId) subscribeUser(vs.id);
    }
  };

  const onMusicState = (_old, state) => {
    const playing = state.status === AudioPlayerStatus.Playing;
    hub.setMusicActive(playing);
    registry.setSlaveMusicActive(guildId, slaveName, playing);
    if (playing) syncChannel();
  };

  syncChannel();
  receiver.speaking.on('start', subscribeUser);

  entry.bridgeResyncUsers = syncChannel;
  entry.bridgeReceiverCtx = { cfg, botUserId, subscribeUser, unsubscribeUser };
  entry.bridgeSpeakingHandler = subscribeUser;

  hookBridgeMusicPlayer(entry, onMusicState);
  ensureBridgeVoiceStateHandler(client);

  const cleanup = () => {
    closed = true;
    for (const t of retryTimers) clearTimeout(t);
    retryTimers.clear();
    hub.stop();
    entry.jitterHub = null;
    registry.setSlaveMusicActive(guildId, slaveName, false);
    if (entry.bridgeResyncUsers === syncChannel) entry.bridgeResyncUsers = null;
    if (entry.bridgeReceiverCtx?.subscribeUser === subscribeUser) {
      entry.bridgeReceiverCtx = null;
    }
    if (entry.bridgeSpeakingHandler === subscribeUser) {
      try { receiver.speaking.off('start', subscribeUser); } catch { /* ignore */ }
      entry.bridgeSpeakingHandler = null;
    }
    unhookBridgeMusicPlayer(entry);
    for (const stream of users.values()) {
      try { stream.destroy(); } catch { /* ignore */ }
    }
    users.clear();
    connection._bridgeReceiverSetup = false;
  };
  entry._bridgeReceiverCleanup = cleanup;
  connection.once('destroyed', cleanup);
}

function unhookBridgeMusicPlayer(entry) {
  const player = entry?.player;
  const handler = entry?._bridgeMusicStateHandler;
  if (player && handler) {
    player.removeListener('stateChange', handler);
  }
  if (entry) entry._bridgeMusicStateHandler = null;
  if (player) player._bridgeSyncHooked = false;
}

function hookBridgeMusicPlayer(entry, onMusicState) {
  const player = entry?.player;
  if (!player) return;
  unhookBridgeMusicPlayer(entry);
  entry._bridgeMusicStateHandler = onMusicState;
  player._bridgeSyncHooked = true;
  player.on('stateChange', onMusicState);
  if (isMusicPlaying(entry)) onMusicState(null, player.state);
}

function bindSlaveBridgeQueueResync(entry, cfg, queue) {
  queue.onBridgeResync = () => {
    const playing = isMusicPlaying(entry);
    entry.jitterHub?.setMusicActive(playing);
    registry.setSlaveMusicActive(cfg.guildId, cfg.name, playing);
    entry.bridgeResyncUsers?.();
  };
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function refreshSlaveBridgeCapture(entry) {
  const client = entry.client;
  const cfg = entry.cfg;
  const connection = entry.connection;
  const queueKey = slaveQueueKey(cfg);
  const queue = MusicManager.getQueue(queueKey);
  const TAG = `[SLAVE:${String(cfg.name).toUpperCase()}]`;

  if (!connection) return false;

  entry._bridgeReceiverCleanup?.();
  entry._bridgeReceiverCleanup = null;
  queue.onBridgeResync = null;

  if (isSlaveBridgeBlocked(cfg.channelId, cfg.guildId)) {
    stopMusicIfPlaying(entry, queueKey, TAG);
    return false;
  }

  if (connection.state.status === VoiceConnectionStatus.Ready) {
    setupReceiver(client, connection, cfg, TAG, entry);
    bindSlaveBridgeQueueResync(entry, cfg, queue);
    entry.bridgeResyncUsers?.();
    return true;
  }

  const promptReconnect = entry.promptReconnect
    ?? entry.voice?.promptRejoin?.bind(entry.voice);
  if (typeof promptReconnect === 'function') {
    console.log(`${TAG} Bridge refresh — voice not ready, quick rejoin`);
    await promptReconnect('bridge refresh');
  } else if (typeof entry.reconnect === 'function') {
    entry.reconnect();
    return false;
  }

  const liveConn = entry.connection;
  if (liveConn?.state?.status !== VoiceConnectionStatus.Ready) return false;
  setupReceiver(client, liveConn, cfg, TAG, entry);
  bindSlaveBridgeQueueResync(entry, cfg, queue);
  entry.bridgeResyncUsers?.();
  return true;
}

function isSlaveBridgeCaptureReady(entry) {
  const connection = entry?.connection;
  if (!connection || connection.state.status !== VoiceConnectionStatus.Ready) return false;
  if (!connection._bridgeReceiverSetup || !entry.jitterHub) return false;
  return true;
}

async function waitForGuildSlaveBridgeReady(guildId, timeoutMs = 12_000) {
  const gid = String(guildId);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const entries = [...registry.state.slaves.values()]
      .filter(e => String(e.cfg?.guildId) === gid);

    const targets = entries.filter(e => !isSlaveBridgeBlocked(e.cfg?.channelId, e.cfg?.guildId));
    if (!targets.length) return true;

    if (targets.every(isSlaveBridgeCaptureReady)) return true;
    await delay(250);
  }
  return false;
}

async function resyncSlaveBridgeForGuild(guildId) {
  const gid = String(guildId);
  const bridgeOn = isGuildBridgeRuntime(gid);

  const entries = [...registry.state.slaves.values()]
    .filter(e => String(e.cfg?.guildId) === gid);

  if (!bridgeOn) {
    for (const entry of entries) {
      const cfg = entry.cfg;
      const queueKey = slaveQueueKey(cfg);
      const queue = MusicManager.getQueue(queueKey);

      entry._bridgeReceiverCleanup?.();
      entry._bridgeReceiverCleanup = null;
      queue.onBridgeResync = null;
      hookBridgeMusicPlayer(entry, (_old, state) => {
        registry.setSlaveMusicActive(
          cfg.guildId,
          cfg.name,
          state.status === AudioPlayerStatus.Playing,
        );
      });
    }
    return { refreshed: 0, total: entries.length };
  }

  let refreshed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (await refreshSlaveBridgeCapture(entry)) refreshed += 1;
    if (i < entries.length - 1) await delay(SLAVE_RESYNC_GAP_MS);
  }
  return { refreshed, total: entries.length };
}

module.exports = startSlave;
module.exports.teardownSlaveDeployment = teardownSlaveDeployment;
module.exports.resyncSlaveBridgeForGuild = resyncSlaveBridgeForGuild;
module.exports.waitForGuildSlaveBridgeReady = waitForGuildSlaveBridgeReady;
module.exports._awayFromHome = awayFromHome;
