// guildRoomBootstrap.js – create voice rooms for subscribed guilds (global mode)
const subscriptionStore = require('./subscriptionStore');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { ensureMasterVoiceRoom } = require('../panel/masterRoomBootstrap');
const {
  bootstrapSlaveRoomAccess,
} = require('../panel/roomAccess');
const { runPool } = require('../util/runPool');

const TAG = '[GLOBAL]';
const BOOT_GUILD_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.BOOT_GUILD_CONCURRENCY || '3', 10) || 3,
);

async function bootstrapGuildRooms(client, guildId, tag = TAG) {
  const id = String(guildId);
  const f = subscriptionStore.getGuildFeatures(id);
  if (!f.allowed) return false;

  let guild = client.guilds.cache.get(id);
  if (!guild) {
    guild = await client.guilds.fetch(id).catch(() => null);
  }
  if (!guild) {
    console.warn(`${tag} autoRoom: guild ${id} not in cache (invite Oud to this server)`);
    return false;
  }

  try {
    const voiceId = await ensureMasterVoiceRoom(guild, { syncAccess: true, tag });
    console.log(`${tag} Voice room ready for ${guild.name} → ${voiceId}`);

    if (f.bridge) {
      const slaves = guildChannelsStore.getGuild(id).slaves || {};
      for (const [slaveKey, slaveCfg] of Object.entries(slaves)) {
        const slaveVoice = slaveCfg?.voiceChannelId?.trim();
        if (!slaveVoice) continue;
        await bootstrapSlaveRoomAccess(guild, slaveVoice, slaveKey, tag);
      }
    }
    return true;
  } catch (err) {
    console.error(`${tag} Room setup failed for ${guild.name}: ${err.message}`);
    return false;
  }
}

async function bootstrapSubscribedGuildRooms(client) {
  const ids = subscriptionStore.listGuildIds();
  await runPool(ids, BOOT_GUILD_CONCURRENCY, (guildId) =>
    bootstrapGuildRooms(client, guildId),
  );
}

module.exports = { bootstrapSubscribedGuildRooms, bootstrapGuildRooms };
