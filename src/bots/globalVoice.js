const {
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const { queueKeyForGuild } = require('../music/queueKey');
const { getGuildMasterChannels } = require('../config/channels');
const { joinVoice, createMusicPlayer } = require('./voiceJoin');
const { isGuildBridgeRuntime } = require('../config/mode');
const { attachGuildBridge, stopGuildBridge } = require('./globalBridge');

function repairGuildMasterRoom(...args) {
  return require('../subscription/guildRoomRecovery').repairGuildMasterRoom(...args);
}

const guildVoice = new Map();
const intentionalVoiceDestroy = new Set();
// T60: pause survives a restart (data/runtime-settings.json).
const runtimeSettings = require('../util/runtimeSettings');
const guildPaused = {
  has: (id) => runtimeSettings.isMasterPaused(id),
  add: (id) => runtimeSettings.setMasterPaused(id, true),
  delete: (id) => runtimeSettings.setMasterPaused(id, false),
};
const connectInflight = new Map();

let guardClient = null;

function setGuardClient(client) {
  guardClient = client;
}

function voiceGroup(guildId) {
  return `global-${guildId}`;
}

function getEntry(guildId) {
  return guildVoice.get(String(guildId)) ?? null;
}

function getVoiceChannelId(guildId) {
  return getEntry(guildId)?.voiceChannelId ?? null;
}

function isGuildVoicePaused(guildId) {
  return guildPaused.has(String(guildId));
}

function pauseGuildVoice(guildId, tag = '[GLOBAL]') {
  const id = String(guildId);
  guildPaused.add(id);
  destroyGuildVoice(id);
  require('../music/MusicManager').haltGuildPlayback(queueKeyForGuild(id)).catch(() => {});
  console.log(`${tag} Master voice paused (guild ${id}) — left voice, panel still active`);
}

async function resumeGuildVoice(client, guildId, tag = '[GLOBAL]') {
  const id = String(guildId);
  guildPaused.delete(id);
  console.log(`${tag} Master voice resumed (guild ${id}) — rejoining…`);
  return joinAssignedGuildVoice(client, id);
}

function clearGuildVoicePause(guildId) {
  guildPaused.delete(String(guildId));
}

function destroyGuildVoice(guildId) {
  const id = String(guildId);
  intentionalVoiceDestroy.add(id);
  const entry = guildVoice.get(id);
  if (entry) stopGuildBridge(entry, id);
  if (entry?.connection) {
    try { entry.connection.destroy(); } catch { /* ignore */ }
  }
  try { getVoiceConnection(id, voiceGroup(id))?.destroy(); } catch { /* ignore */ }
  guildVoice.delete(id);
  setTimeout(() => intentionalVoiceDestroy.delete(id), 3000);
}

function isGuildVoiceHealthy(guildId) {
  const id = String(guildId);
  if (isGuildVoicePaused(id)) return false;
  const assigned = getGuildMasterChannels(id).voiceChannelId;
  if (!assigned) return false;
  const entry = getEntry(id);
  const conn = entry?.connection ?? getVoiceConnection(id, voiceGroup(id));
  return Boolean(
    conn
    && conn.joinConfig?.channelId === assigned
    && conn.state.status === VoiceConnectionStatus.Ready
    && entry?.player,
  );
}

async function connectGuildVoiceImpl(guild, targetChannelId, queueKey) {
  const guildId = guild.id;
  if (isGuildVoicePaused(guildId)) {
    const err = new Error('VOICE_PAUSED');
    err.code = 'VOICE_PAUSED';
    throw err;
  }
  const group = voiceGroup(guildId);
  const existingConn = getVoiceConnection(guildId, group);
  let entry = getEntry(guildId);

  if (
    existingConn?.joinConfig?.channelId === targetChannelId
    && entry?.player
    && entry.connection === existingConn
    && existingConn.state.status === VoiceConnectionStatus.Ready
  ) {
    if (isGuildBridgeRuntime(guildId) && !entry.bridgePlayer) {
      attachGuildBridge(guildId, existingConn, queueKey, entry);
    }
    return {
      player: entry.player,
      connection: existingConn,
      voiceChannelId: targetChannelId,
      reused: true,
    };
  }

  if (existingConn) {
    intentionalVoiceDestroy.add(guildId);
    try { existingConn.destroy(); } catch { /* ignore */ }
    setTimeout(() => intentionalVoiceDestroy.delete(guildId), 2000);
    await new Promise(r => setTimeout(r, 400));
  }

  const connection = joinVoice({
    channelId: targetChannelId,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    group,
    selfDeaf: false,
    selfMute: false,
  }, '[GLOBAL]');

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (err) {
    try { connection.destroy(); } catch { /* ignore */ }
    if (err?.name === 'AbortError') {
      const abortErr = new Error('VOICE_ABORTED');
      abortErr.code = 'VOICE_ABORTED';
      throw abortErr;
    }
    throw err;
  }

  const player = createMusicPlayer();

  entry = {
    connection,
    player,
    musicPlayer: player,
    bridgePlayer: null,
    bridgeRelay: null,
    musicActive: false,
    voiceChannelId: targetChannelId,
  };
  guildVoice.set(guildId, entry);

  if (isGuildBridgeRuntime(guildId)) {
    attachGuildBridge(guildId, connection, queueKey, entry);
  } else {
    connection.subscribe(player);
    require('../music/MusicManager').rebindPlayer(queueKey, player, connection);
  }

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (intentionalVoiceDestroy.has(guildId)) return;
    if (isGuildVoicePaused(guildId)) return;
    const subscriptionStore = require('../subscription/subscriptionStore');
    if (!subscriptionStore.isGuildAllowed(guildId)) return;
    if (guardClient) {
      const { scheduleGuildVoiceRejoin } = require('./globalGuildGuard');
      scheduleGuildVoiceRejoin(guardClient, guildId, 'voice disconnected');
    }
  });

  return { player: entry.player, connection, voiceChannelId: targetChannelId, reused: false };
}

async function connectGuildVoice(guild, targetChannelId, queueKey) {
  const guildId = guild.id;
  const prev = connectInflight.get(guildId) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => connectGuildVoiceImpl(guild, targetChannelId, queueKey));
  const tracked = run.catch(() => {}).finally(() => {
    if (connectInflight.get(guildId) === tracked) connectInflight.delete(guildId);
  });
  connectInflight.set(guildId, tracked);
  return run;
}

/** Join assigned master room when subscription is active (no user in voice required). */
// T56: depth bounds the repair <-> join cycle; a guild whose join keeps failing used to loop forever
// and block boot (slaves never started). The periodic room audit retries it later.
const MAX_JOIN_REPAIR = 2;
// T72 (review R6): one quick retry after a failed join, instead of waiting for the 5-minute audit.
const QUICK_RETRY_MS = 45_000;
const quickRetried = new Set();
async function joinAssignedGuildVoice(client, guildId, depth = 0) {
  const id = String(guildId);
  const repair = () => {
    if (depth >= MAX_JOIN_REPAIR) {
      if (!quickRetried.has(id)) {
        quickRetried.add(id);
        console.warn(`[GLOBAL] Voice join still failing for ${id} after ${depth + 1} tries — retrying in ${QUICK_RETRY_MS / 1000}s`);
        setTimeout(() => { joinAssignedGuildVoice(client, id, 0).catch(() => {}); }, QUICK_RETRY_MS).unref?.();
      } else {
        console.warn(`[GLOBAL] Voice join still failing for ${id} after ${depth + 1} tries — next room audit retries`);
      }
      return false;
    }
    return repairGuildMasterRoom(client, id, '[GLOBAL]', depth + 1);
  };
  if (isGuildVoicePaused(id)) return false;
  const assigned = getGuildMasterChannels(id).voiceChannelId;
  if (!assigned) return repair();

  const guild = client.guilds.cache.get(id) ?? await client.guilds.fetch(id).catch(() => null);
  if (!guild) return false;

  const channel = guild.channels.cache.get(assigned)
    ?? await guild.channels.fetch(assigned).catch(() => null);
  if (!channel) return repair();

  const key = queueKeyForGuild(id);
  try {
    const result = await connectGuildVoice(guild, assigned, key);
    quickRetried.delete(id);
    if (!result.reused) {
      console.log(`[GLOBAL] Joined voice room #${channel.name} in ${guild.name}`);
    }
    return true;
  } catch (err) {
    console.warn(`[GLOBAL] Voice join failed for ${guild.name}: ${err.message} — repairing…`);
    return repair();
  }
}

async function ensureMemberVoice(member, client, queueKey) {
  if (!member?.guild) {
    const err = new Error('NOT_IN_VOICE');
    err.code = 'NOT_IN_VOICE';
    throw err;
  }

  const guildId = member.guild.id;
  if (isGuildVoicePaused(guildId)) {
    const err = new Error('VOICE_PAUSED');
    err.code = 'VOICE_PAUSED';
    throw err;
  }
  let assigned = getGuildMasterChannels(guildId);
  let targetChannelId = assigned.voiceChannelId;
  if (!targetChannelId) {
    const ok = await repairGuildMasterRoom(client, guildId);
    if (!ok) {
      const err = new Error('NO_ROOM');
      err.code = 'NO_ROOM';
      throw err;
    }
    assigned = getGuildMasterChannels(guildId);
    targetChannelId = assigned.voiceChannelId;
  }

  const memberChannelId = member.voice?.channelId;
  if (!memberChannelId || memberChannelId !== targetChannelId) {
    const err = new Error('NOT_IN_VOICE');
    err.code = 'NOT_IN_VOICE';
    throw err;
  }

  let channel = member.guild.channels.cache.get(targetChannelId);
  if (!channel) {
    const ok = await repairGuildMasterRoom(client, guildId);
    if (!ok) {
      const err = new Error('NOT_IN_VOICE');
      err.code = 'NOT_IN_VOICE';
      throw err;
    }
    targetChannelId = getGuildMasterChannels(guildId).voiceChannelId;
    channel = member.guild.channels.cache.get(targetChannelId);
    if (!channel || member.voice?.channelId !== targetChannelId) {
      const err = new Error('NOT_IN_VOICE');
      err.code = 'NOT_IN_VOICE';
      throw err;
    }
  }
  const key = queueKey || queueKeyForGuild(guildId);
  return connectGuildVoice(member.guild, targetChannelId, key);
}

function destroyAllGuildVoice() {
  for (const id of [...guildVoice.keys()]) {
    destroyGuildVoice(id);
  }
}

function isIntentionalVoiceDestroy(guildId) {
  return intentionalVoiceDestroy.has(String(guildId));
}

module.exports = {
  ensureMemberVoice,
  joinAssignedGuildVoice,
  getVoiceChannelId,
  destroyGuildVoice,
  destroyAllGuildVoice,
  getEntry,
  isGuildVoiceHealthy,
  isGuildVoicePaused,
  pauseGuildVoice,
  resumeGuildVoice,
  clearGuildVoicePause,
  isIntentionalVoiceDestroy,
  setGuardClient,
};
