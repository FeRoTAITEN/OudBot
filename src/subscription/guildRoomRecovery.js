// Repair missing/deleted master voice + text channels (GLOBAL per-guild)
const { ChannelType } = require('discord.js');
const subscriptionStore = require('./subscriptionStore');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { isTextChannelValid } = require('../config/channels');
const { ensureMasterVoiceRoom } = require('../panel/masterRoomBootstrap');
const { clearRoomSyncCache } = require('../panel/roomAccess');
const { logOnce } = require('../util/logger');
const { runPool } = require('../util/runPool');
const { voiceChannelStatus } = require('../util/channelStatus');

const AUDIT_CONCURRENCY = Math.max(1, parseInt(process.env.ROOM_AUDIT_CONCURRENCY || '6', 10) || 6);

function globalVoice() {
  return require('../bots/globalVoice');
}

function syncGlobalGuildRoom(guildId) {
  return require('../music/musicCommands').syncGlobalGuildRoom(guildId);
}

async function fetchVoiceChannel(guild, channelId) {
  if (!channelId) return null;
  const cached = guild.channels.cache.get(channelId);
  if (cached?.type === ChannelType.GuildVoice && cached.guildId === guild.id) return cached;
  const ch = await guild.channels.fetch(channelId, { force: true }).catch(() => null);
  if (ch?.type !== ChannelType.GuildVoice || ch.guildId !== guild.id) return null;
  return ch;
}

async function resolveGuild(client, guildId) {
  const id = String(guildId);
  return client.guilds.cache.get(id) ?? await client.guilds.fetch(id).catch(() => null);
}

function resolveTextPatch(guild, storedText, voiceId) {
  if (storedText && isTextChannelValid(guild, storedText) && storedText !== voiceId) {
    return {};
  }
  return { textChannelId: voiceId };
}

/**
 * Light check — skip full repair when voice is connected and stored room still exists.
 */
async function isGuildRoomHealthy(client, guildId) {
  const id = String(guildId);
  if (globalVoice().isGuildVoicePaused(id)) return true;

  if (!globalVoice().isGuildVoiceHealthy(id)) return false;

  const master = guildChannelsStore.getMaster(id);
  const storedVoice = master?.voiceChannelId?.trim();
  if (!storedVoice) return false;

  const guild = await resolveGuild(client, id);
  if (!guild) return false;

  const voice = await fetchVoiceChannel(guild, storedVoice);
  if (!voice) return false;

  const storedText = master?.textChannelId?.trim();
  if (storedText && storedText !== storedVoice && !isTextChannelValid(guild, storedText)) {
    return false;
  }

  return true;
}

/**
 * Ensure master voice + text exist, recreate if deleted/missing, then join voice.
 */
async function repairGuildMasterRoom(client, guildId, tag = '[GLOBAL]', depth = 0) {
  const id = String(guildId);
  if (!subscriptionStore.isGuildAllowed(id)) return false;

  if (globalVoice().isGuildVoicePaused(id)) {
    syncGlobalGuildRoom(id);
    return true;
  }

  const guild = await resolveGuild(client, id);
  if (!guild) {
    logOnce(`norepair:${id}`, 6 * 3600_000, () => console.warn(`${tag} Cannot repair room — bot not in guild ${id}`));
    return false;
  }

  if (await isGuildRoomHealthy(client, id)) {
    syncGlobalGuildRoom(id);
    return true;
  }

  const master = guildChannelsStore.getMaster(id);
  const storedVoice = master?.voiceChannelId?.trim();
  const storedText = master?.textChannelId?.trim();

  const status = storedVoice ? await voiceChannelStatus(guild, storedVoice) : { status: 'gone', channel: null };
  if (status.status === 'unknown') {
    // T58c: could not check (network / rate limit / access) — never recreate the room on a guess.
    logOnce(`roomunknown:${id}`, 10 * 60_000, () => console.warn(`${tag} Could not check room ${storedVoice} in ${guild.name} — retrying on next audit`));
    return false;
  }
  const existingVoice = status.channel;
  const textOk = storedText && isTextChannelValid(guild, storedText);

  if (!existingVoice) {
    if (storedVoice) {
      console.warn(`${tag} Voice room ${storedVoice} missing in ${guild.name} — recreating…`);
      clearRoomSyncCache(id, storedVoice);
    } else {
      console.warn(`${tag} No voice room configured for ${guild.name} — creating…`);
    }
    globalVoice().destroyGuildVoice(id);
  } else if (!textOk) {
    console.warn(`${tag} Text channel missing for ${guild.name} — using voice room chat`);
    guildChannelsStore.mergeMaster(id, { textChannelId: existingVoice.id });
    syncGlobalGuildRoom(id);
  }

  let voiceId;
  try {
    voiceId = await ensureMasterVoiceRoom(guild, { syncAccess: true, tag });
  } catch (err) {
    console.error(`${tag} Room repair failed for ${guild.name}: ${err.message}`);
    return false;
  }

  const latest = guildChannelsStore.getMaster(id);
  if (!latest?.voiceChannelId || latest.voiceChannelId !== voiceId) {
    const patch = { voiceChannelId: voiceId, ...resolveTextPatch(guild, storedText, voiceId) };
    guildChannelsStore.mergeMaster(id, patch);
    console.log(`${tag} Repaired room for ${guild.name} → ${voiceId}`);
  }

  syncGlobalGuildRoom(id);
  return globalVoice().joinAssignedGuildVoice(client, id, depth);
}

/** Audit all subscribed guilds — handles rooms deleted while bot was offline. */
async function auditSubscribedGuildRooms(client, tag = '[GLOBAL]') {
  const ids = subscriptionStore.listGuildIds();
  // Guilds are independent: repair in parallel (boot waits on this before starting slaves).
  await runPool(ids, AUDIT_CONCURRENCY, async (guildId) => {
    try {
      if (await isGuildRoomHealthy(client, guildId)) return;
      await repairGuildMasterRoom(client, guildId, tag);
    } catch (err) {
      console.warn(`${tag} Room audit failed for ${guildId}: ${err.message}`);
    }
  });
}

module.exports = {
  repairGuildMasterRoom,
  auditSubscribedGuildRooms,
  isGuildRoomHealthy,
  fetchVoiceChannel,
};
