const { ChannelType, PermissionFlagsBits } = require('discord.js');
const guildChannelsStore = require('./guildChannelsStore');
const {
  syncBridgeRoomAccessOnce,
  ensureOudRole,
  hiddenRoomCreateOverwrites,
  applyHiddenRoomAccess,
  warnIfBotCannotChat,
  botCanUseMasterRoom,
  masterRoomMissingPerms,
  isStructuralMasterGap,
  clearRoomSyncCache,
} = require('./roomAccess');
const { isTextChannelValid } = require('../config/channels');
const { t } = require('../i18n/context');
const { markBotCreatedRoom, isOudManagedRoom } = require('./oudRoomRegistry');
const { logOnce } = require('../util/logger');

/**
 * Cache first (deleted rooms are evicted before channelDelete fires, and a
 * REST fetch right after creating a room can fail and cause a duplicate
 * room), REST as fallback for rooms another client created moments ago.
 */
const { voiceChannelStatus } = require('../util/channelStatus');

async function syncExistingRoomAccess(guild, channel, tag) {
  clearRoomSyncCache(guild.id, channel.id);
  await syncBridgeRoomAccessOnce(guild, channel, tag, { force: true }).catch(err => {
    logOnce(`roomsync:${guild.id}:${err.message}`, 3600_000, () => console.warn(`${tag} Room access sync failed in ${guild.name} (${guild.id}): ${err.message} — check that the Oud bot role is above the "Oud" roles and has Manage Roles + Manage Channels`));
    // T59: tell the server owner what to fix (once a week at most).
    require('./ownerNotice').notifyRoomAccessProblem(guild, tag, { channel }).catch(() => {});
  });
  if (!botCanUseMasterRoom(guild, channel)) {
    clearRoomSyncCache(guild.id, channel.id);
    await syncBridgeRoomAccessOnce(guild, channel, tag, { force: true }).catch(() => {});
  }
}

async function ensureMasterVoiceRoomImpl(guild, { syncAccess = true, tag = '[MASTER]' } = {}) {
  const guildId = guild.id;
  const stored = guildChannelsStore.getMaster(guildId);
  let abandoned = null;
  if (stored?.voiceChannelId) {
    const check = await voiceChannelStatus(guild, stored.voiceChannelId);
    if (check.status === 'unknown') {
      // T58c: could not check the saved room — do not create a second Oud room on a network error.
      throw new Error(`could not check saved room ${stored.voiceChannelId} (will retry)`);
    }
    const existing = check.channel;
    if (existing) {
      if (syncAccess) {
        await syncExistingRoomAccess(guild, existing, tag);
      }

      const structural = isStructuralMasterGap(guild, existing);
      if (structural && !isOudManagedRoom(existing)) {
        const missing = masterRoomMissingPerms(guild, existing).join(', ');
        console.warn(
          `${tag} Can't use assigned room #${existing.name} (missing: ${missing}) — returning to own room`,
        );
        abandoned = { name: existing.name, missing };
        clearRoomSyncCache(guild.id, existing.id);
        guildChannelsStore.mergeMaster(guildId, { voiceChannelId: null, textChannelId: null });
      } else {
        if (syncAccess) {
          await warnIfBotCannotChat(guild, existing, tag);
        }
        const latest = guildChannelsStore.getMaster(guildId);
        if (!isTextChannelValid(guild, latest?.textChannelId)) {
          guildChannelsStore.mergeMaster(guildId, { textChannelId: existing.id });
        }
        return existing.id;
      }
    }
    if (!existing) {
      console.warn(`${tag} Saved voice room ${stored.voiceChannelId} missing — creating a new one`);
    }
  }

  const createOpts = {
    name: process.env.MASTER_ROOM_NAME?.trim() || 'Voice Bridge',
    type: ChannelType.GuildVoice,
    parent: usableParentId(guild),
  };
  let hiddenAtCreate = false;
  try {
    const oud = await ensureOudRole(guild, tag);
    createOpts.permissionOverwrites = hiddenRoomCreateOverwrites(guild, oud.id);
    hiddenAtCreate = true;
  } catch (err) {
    console.warn(`${tag} Room overwrites at create skipped: ${err.message}`);
  }
  const ch = await guild.channels.create(createOpts);
  markBotCreatedRoom(ch.id);

  if (!hiddenAtCreate) {
    await applyHiddenRoomAccess(guild, ch, tag, guildId, 'master').catch(err => {
      console.warn(`${tag} One-time hide at create failed: ${err.message}`);
    });
  }

  await syncBridgeRoomAccessOnce(guild, ch, tag, { force: true }).catch(err => {
    console.warn(`${tag} Room access setup failed: ${err.message}`);
  });
  await warnIfBotCannotChat(guild, ch, tag);

  guildChannelsStore.mergeMaster(guildId, {
    voiceChannelId: ch.id,
    textChannelId: ch.id,
  });
  console.log(`${tag} Created voice room #${ch.name} (${ch.id})`);

  if (abandoned) {
    await ch.send(
      t('master.returnedToOwnRoom', { channel: `#${abandoned.name}`, missing: abandoned.missing }),
    ).catch(() => {});
  }
  return ch.id;
}

/** Use the configured category only if the bot can manage channels inside it. */
function usableParentId(guild) {
  const parentId = process.env.MASTER_ROOM_CATEGORY_ID?.trim();
  if (!parentId) return undefined;
  const parent = guild.channels.cache.get(parentId);
  const me = guild.members.me;
  const canUse = parent && me
    && parent.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)
    && parent.permissionsFor(me)?.has(PermissionFlagsBits.Connect);
  if (!canUse) {
    console.warn(`[MASTER] Category ${parentId} blocks the bot — creating room without a category`);
    return undefined;
  }
  return parentId;
}

/** Per-guild inflight — GLOBAL mode runs ensure for many guilds in parallel. */
const masterRoomEnsureInflight = new Map();

/**
 * Reuse saved master voice room, or create one on first boot / if deleted.
 */
async function ensureMasterVoiceRoom(guild, opts = {}) {
  const guildId = guild.id;
  const inflight = masterRoomEnsureInflight.get(guildId);
  if (inflight) return inflight;

  const promise = ensureMasterVoiceRoomImpl(guild, opts).finally(() => {
    if (masterRoomEnsureInflight.get(guildId) === promise) {
      masterRoomEnsureInflight.delete(guildId);
    }
  });
  masterRoomEnsureInflight.set(guildId, promise);
  return promise;
}

module.exports = { ensureMasterVoiceRoom };
