const { ChannelType } = require('discord.js');
const guildChannelsStore = require('./guildChannelsStore');
const { getMasterChannels, isTextChannelValid } = require('../config/channels');
const { ensureMasterVoiceRoom } = require('./masterRoomBootstrap');
const {
  prepareAssignedVoiceRoom,
  botCanJoinVoiceRoom,
  slaveVoiceMissingPerms,
  notifySlaveRoomAccessIssues,
} = require('./roomAccess');
const registry = require('../bridge/registry');
const { slaveRegistryKey, slaveQueueKey } = require('../music/slaveQueueKey');
const { isGuildBridgeRuntime } = require('../config/mode');
const { voiceChannelStatus } = require('../util/channelStatus');

function voiceChannelValid(guild, channelId) {
  const ch = guild?.channels?.cache?.get(channelId);
  return ch?.type === ChannelType.GuildVoice;
}

function masterGuildFor(guild) {
  return registry.state.master?.client?.guilds?.cache?.get(guild.id) ?? guild;
}

async function fetchVoiceChannel(guild, channelId) {
  if (!channelId) return null;
  const cached = guild.channels.cache.get(channelId);
  if (cached?.type === ChannelType.GuildVoice) return cached;
  const ch = await guild.channels.fetch(channelId, { force: true }).catch(() => null);
  return ch?.type === ChannelType.GuildVoice ? ch : null;
}

/** True when slave voice is Master room (fallback / collision) — no chat replies. */
function isSlaveOnMasterFallback(guildId, botKey) {
  const gid = String(guildId);
  const key = String(botKey);
  const masterVoice = getMasterChannels(gid).voiceChannelId?.trim();
  if (!masterVoice) return false;
  const slaveVoice = guildChannelsStore.getSlave(gid, key)?.voiceChannelId?.trim();
  return slaveVoice === masterVoice;
}

/** Resolve Master voice + text ids (create if needed). */
async function resolveMasterVoiceFallback(guild) {
  const mg = masterGuildFor(guild);
  let voiceId;
  if (isGuildBridgeRuntime(guild.id)) {
    voiceId = await ensureMasterVoiceRoom(mg);
  } else {
    voiceId = getMasterChannels(guild.id).voiceChannelId;
  }
  if (!voiceChannelValid(guild, voiceId)) {
    const fetched = voiceId
      ? await guild.channels.fetch(voiceId, { force: true }).catch(() => null)
      : null;
    if (fetched?.type !== ChannelType.GuildVoice) {
      throw new Error('No valid Master voice room for slave fallback');
    }
  }
  const masterCh = getMasterChannels(guild.id);
  let textId = masterCh.textChannelId || voiceId;
  if (!isTextChannelValid(guild, textId)) textId = voiceId;
  return { voiceId, textId };
}

/**
 * Resolve slave voice room; if saved channel is missing or locked, fall back to Master room.
 */
async function ensureSlaveVoiceRoom(guild, botKey, { botUserId = null, tag = '[SLAVE]' } = {}) {
  const key = String(botKey);
  const stored = guildChannelsStore.getSlave(guild.id, key) || {};
  const prevVoice = stored.voiceChannelId?.trim() || null;
  let voiceId = prevVoice;
  let fellBack = false;
  // T58c: the saved room is replaced only when Discord says it is gone. A failed check or
  // missing permissions is a runtime-only fallback; the saved room stays for the return-home check.
  let keepSaved = false;
  const bridgeRuntime = isGuildBridgeRuntime(guild.id);
  const mg = masterGuildFor(guild);
  let syncedAssigned = false;

  const { status, channel: ch } = prevVoice ? await voiceChannelStatus(guild, prevVoice) : { status: 'gone', channel: null };
  if (status === 'unknown') {
    console.warn(`${tag} Could not check saved room ${prevVoice} — using Master room for now (saved room kept)`);
    voiceId = null;
    fellBack = true;
    keepSaved = true;
  } else if (status === 'ok') {
    let member = botUserId
      ? (guild.members.cache.get(botUserId)
        ?? await guild.members.fetch(botUserId).catch(() => null))
      : guild.members.me;
    if (member) {
      await prepareAssignedVoiceRoom(mg, ch, {
        botUserId,
        hideFromEveryone: false,
        tag,
        syncEntryPerms: false,
      }).catch(() => {});
      syncedAssigned = true;
      if (botUserId) {
        member = await guild.members.fetch(botUserId).catch(() => member);
      }
      if (!botCanJoinVoiceRoom(guild, ch, member)) {
        const missing = slaveVoiceMissingPerms(guild, ch, member).join(', ');
        const label = member?.user?.tag ?? botUserId;
        await notifySlaveRoomAccessIssues(guild, ch, {
          botUserId: member?.id ?? botUserId,
          botLabel: label,
          missing,
          tag,
        }).catch(() => {});
        if (bridgeRuntime) {
          console.warn(
            `${tag} Can't join assigned room #${ch.name} (missing: ${missing}) — falling back to Master room (chat silent, saved room kept)`,
          );
          voiceId = null;
          fellBack = true;
          keepSaved = true;
        } else {
          console.warn(
            `${tag} Tight perms on #${ch.name} (${missing}) — Oud will try join anyway`,
          );
        }
      }
    }
  } else {
    voiceId = null;
  }

  if (!voiceId) {
    if (prevVoice && status === 'gone') {
      console.warn(`${tag} Saved voice room ${prevVoice} deleted — falling back to Master room`);
    }
    const { voiceId: masterVoice } = await resolveMasterVoiceFallback(guild);
    voiceId = masterVoice;
    fellBack = fellBack || (prevVoice !== voiceId);

    if (!keepSaved) {
      guildChannelsStore.mergeSlave(guild.id, key, {
        voiceChannelId: voiceId,
        textChannelId: '',
      });
    }
  }

  let textId = null;
  if (!fellBack) {
    textId = guildChannelsStore.getSlave(guild.id, key)?.textChannelId?.trim();
    if (!isTextChannelValid(guild, textId)) {
      textId = voiceId;
      guildChannelsStore.mergeSlave(guild.id, key, { textChannelId: textId });
    }
  }

  const room = guild.channels.cache.get(voiceId);
  if (room && !syncedAssigned) {
    await prepareAssignedVoiceRoom(mg, room, {
      botUserId,
      hideFromEveryone: false,
      tag,
      syncEntryPerms: false,
    }).catch(() => {});
  }

  return {
    channelId: voiceId,
    textChannelId: textId,
    fellBackToMaster: fellBack,
    savedRoomKept: keepSaved,
  };
}

/** Force slave onto Master voice — silent in all text chats. */
async function forceSlaveToMasterVoiceFallback(guild, botKey, reason, { botUserId = null, tag = '[SLAVE]' } = {}) {
  const key = String(botKey);
  const { voiceId } = await resolveMasterVoiceFallback(guild);
  // T56: a join that failed for network reasons must not erase the slave's own room. Keep the
  // saved room when it still exists (runtime-only fallback; the next rejoin/restart goes back to it).
  const saved = guildChannelsStore.getSlave(guild.id, key)?.voiceChannelId?.trim();
  const savedExists = saved && saved !== voiceId && (await voiceChannelStatus(guild, saved)).status !== 'gone';
  if (!savedExists) {
    guildChannelsStore.mergeSlave(guild.id, key, {
      voiceChannelId: voiceId,
      textChannelId: '',
    });
  }
  const ch = guild.channels.cache.get(voiceId)
    ?? await fetchVoiceChannel(guild, voiceId);
  if (ch) {
    await prepareAssignedVoiceRoom(masterGuildFor(guild), ch, {
      botUserId,
      hideFromEveryone: false,
      tag,
    }).catch(() => {});
  }
  console.warn(`${tag} Forced Master voice fallback (${reason}) — chat silent`);
  return {
    channelId: voiceId,
    textChannelId: null,
    fellBackToMaster: true,
  };
}

function applySlaveRoomToRuntime(client, cfg, voice, resolved) {
  cfg.channelId = resolved.channelId;
  cfg.textChannelId = resolved.textChannelId;
  voice?.setChannelId(resolved.channelId);
  client._slaveChatSilenced = Boolean(resolved.fellBackToMaster);
  const entry = registry.state.slaves.get(slaveRegistryKey(cfg));
  if (entry?.cfg) {
    entry.cfg.channelId = resolved.channelId;
    entry.cfg.textChannelId = resolved.textChannelId;
  }
  const { updateMusicRoom } = require('../music/musicCommands');
  updateMusicRoom(client, resolved.channelId, resolved.textChannelId, slaveQueueKey(cfg));
}

/**
 * When Master voice room is deleted, repoint every slave that was on that room
 * (assigned or connected) to the new Master room — one pass from Master bot.
 */
async function reassignSlavesToMasterRoom(guild, deletedChannelId, tag = '[MASTER]') {
  if (!deletedChannelId || !isGuildBridgeRuntime(guild.id)) return [];

  const botStore = require('./botStore');
  const masterCh = getMasterChannels(guild.id);
  const newVoiceId = masterCh.voiceChannelId;
  if (!newVoiceId || !voiceChannelValid(guild, newVoiceId)) return [];

  const moved = [];

  for (const { name, guildId: gid } of botStore.listSlaves(guild.id)) {
    const key = String(name);
    const stored = guildChannelsStore.getSlave(guild.id, key) || {};
    const entry = registry.getSlaveEntry(gid, key);
    const onDeleted = stored.voiceChannelId === deletedChannelId
      || entry?.cfg?.channelId === deletedChannelId;

    if (!onDeleted) continue;

    guildChannelsStore.mergeSlave(guild.id, key, {
      voiceChannelId: newVoiceId,
      textChannelId: '',
    });

    const resolved = {
      channelId: newVoiceId,
      textChannelId: null,
      fellBackToMaster: true,
    };

    if (entry?.client) {
      const slaveTag = entry.tag || `[SLAVE:${key.toUpperCase()}]`;
      await prepareAssignedVoiceRoom(masterGuildFor(guild), newVoiceId, {
        botUserId: entry.client.user?.id,
        hideFromEveryone: false,
        tag: slaveTag,
      }).catch(() => {});
      applySlaveRoomToRuntime(
        entry.client,
        entry.cfg || { name: key },
        entry.voice,
        resolved,
      );
      if (!entry.voice?.isPaused?.()) {
        entry.reconnect?.();
      }
      console.log(`${tag} Slave #${key} → Master room #${guild.channels.cache.get(newVoiceId)?.name || newVoiceId}`);
    } else {
      console.log(`${tag} Slave #${key} saved → Master room (offline)`);
    }

    moved.push(key);
  }

  return moved;
}

module.exports = {
  ensureSlaveVoiceRoom,
  applySlaveRoomToRuntime,
  reassignSlavesToMasterRoom,
  resolveMasterVoiceFallback,
  forceSlaveToMasterVoiceFallback,
  isSlaveOnMasterFallback,
  voiceChannelValid,
  masterGuildFor,
};
