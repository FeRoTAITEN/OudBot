// GLOBAL mode — per-guild voice rejoin + room delete recovery
const subscriptionStore = require('../subscription/subscriptionStore');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { getGuildMasterChannels } = require('../config/channels');
const { clearRoomSyncCache, listTrackedBridgeChannelIds, scheduleTrackedChannelResync } = require('../panel/roomAccess');
const { repairGuildMasterRoom } = require('../subscription/guildRoomRecovery');
const { safeListener } = require('../util/safeListener');

function gv() {
  return require('./globalVoice');
}

const TAG = '[GLOBAL]';
const rejoinTimers = new Map();
const rejoinInflight = new Set();

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clearRejoinTimer(guildId) {
  const id = String(guildId);
  const t = rejoinTimers.get(id);
  if (t) {
    clearTimeout(t);
    rejoinTimers.delete(id);
  }
}

async function runGuildVoiceRejoin(client, guildId, reason) {
  const id = String(guildId);
  if (gv().isGuildVoicePaused(id)) return;
  if (rejoinInflight.has(id)) return;
  if (!subscriptionStore.isGuildAllowed(id)) return;

  const assigned = getGuildMasterChannels(id).voiceChannelId;
  if (assigned && gv().isGuildVoiceHealthy(id)) return;

  rejoinInflight.add(id);
  try {
    console.log(`${TAG} Rejoining voice in guild ${id} (${reason})…`);
    gv().destroyGuildVoice(id);
    await sleep(1500);
    await repairGuildMasterRoom(client, id, TAG);
  } catch (err) {
    console.warn(`${TAG} Voice rejoin failed for ${id}: ${err.message}`);
  } finally {
    rejoinInflight.delete(id);
  }
}

function scheduleGuildVoiceRejoin(client, guildId, reason) {
  const id = String(guildId);
  if (gv().isGuildVoicePaused(id)) return;
  if (!subscriptionStore.isGuildAllowed(id)) return;
  if (gv().isGuildVoiceHealthy(id)) return;
  clearRejoinTimer(id);
  rejoinTimers.set(id, setTimeout(() => {
    rejoinTimers.delete(id);
    runGuildVoiceRejoin(client, id, reason).catch(() => {});
  }, 4000));
}

async function handleMasterVoiceRoomDeleted(client, guild, deletedVoiceId) {
  console.warn(`${TAG} Voice room deleted in ${guild.name} — repairing…`);
  clearRoomSyncCache(guild.id, deletedVoiceId);
  gv().destroyGuildVoice(guild.id);
  await sleep(800);
  await repairGuildMasterRoom(client, guild.id, TAG);
}

function attachGlobalGuildGuards(client) {
  if (client._globalGuildGuardsAttached) return;
  client._globalGuildGuardsAttached = true;

  client.on('voiceStateUpdate', safeListener('[GUARD]', (oldState, newState) => {
    if (!client.user) return;
    const memberId = client.user.id;
    let guildId = null;
    let channelId = null;

    if (newState.member?.id === memberId) {
      guildId = newState.guild?.id;
      channelId = newState.channelId;
    } else if (oldState.member?.id === memberId && !newState.channelId) {
      guildId = oldState.guild?.id;
      channelId = null;
    }
    if (!guildId || !subscriptionStore.isGuildAllowed(guildId)) return;
    if (gv().isGuildVoicePaused(guildId)) return;
    if (gv().isIntentionalVoiceDestroy(guildId)) return;

    const assigned = getGuildMasterChannels(guildId).voiceChannelId;
    if (!assigned) return;
    if (channelId === assigned) return;
    if (gv().isGuildVoiceHealthy(guildId)) return;

    scheduleGuildVoiceRejoin(client, guildId, `bot left voice (${channelId ?? 'none'})`);
  }));

  client.on('channelDelete', safeListener('[GUARD]', async (channel) => {
    const guildId = channel.guild?.id;
    if (!guildId || !subscriptionStore.isGuildAllowed(guildId)) return;

    const master = guildChannelsStore.getMaster(guildId);
    const voiceId = master?.voiceChannelId?.trim();
    const textId = master?.textChannelId?.trim();

    if (channel.id === voiceId) {
      const guild = client.guilds.cache.get(guildId)
        ?? await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return;
      try {
        await handleMasterVoiceRoomDeleted(client, guild, voiceId);
      } catch (err) {
        console.error(`${TAG} Could not recreate voice room for ${guild.name}: ${err.message}`);
      }
      return;
    }

    if (textId && channel.id === textId && textId !== voiceId) {
      console.warn(`${TAG} Text channel deleted in ${channel.guild?.name} — repairing…`);
      await repairGuildMasterRoom(client, guildId, TAG);
    }
  }));

  client.on('channelUpdate', safeListener('[GUARD]', (oldChannel, newChannel) => {
    const guild = newChannel.guild;
    if (!guild || !subscriptionStore.isGuildAllowed(guild.id)) return;

    const oldParent = oldChannel.parentId ?? null;
    const newParent = newChannel.parentId ?? null;
    if (oldParent === newParent) return;

    const tracked = listTrackedBridgeChannelIds(guild.id);
    if (!tracked.has(newChannel.id)) return;

    console.log(`${TAG} #${newChannel.name} moved category — re-syncing channel permissions…`);
    scheduleTrackedChannelResync(guild, newChannel.id, TAG);
  }));
}

function cancelGuildVoiceGuard(guildId) {
  const id = String(guildId);
  clearRejoinTimer(id);
  rejoinInflight.delete(id);
}

module.exports = {
  attachGlobalGuildGuards,
  scheduleGuildVoiceRejoin,
  cancelGuildVoiceGuard,
};
