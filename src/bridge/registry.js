// registry.js – shared state for bridge control panel
const { PermissionsBitField } = require('discord.js');
const { AudioPlayerStatus } = require('@discordjs/voice');
const { getMasterChannels } = require('../config/channels');
const { isSlaveBridgeBlocked } = require('./roomCollision');
const { resolveSlaveRoom, isUserSourceKey, parseUserSourceKey, makeUserSourceKey } = require('./sourceKey');
const { slaveQueueKey, slaveRegistryKey } = require('../music/slaveQueueKey');
const runtimeSettings = require('../util/runtimeSettings');

const state = {
  master: null,
  slaves: new Map(),
  controlClientId: null,
  sourceStats: new Map(),
  sourceSettings: new Map(),
  /** guildId ('' for legacy) -> solo room name */
  soloByGuild: new Map(),
  /** Slave rooms with music playing — relay uses deeper buffers for their speakers. */
  slaveMusicActive: new Set(),
};

function ensureSource(name) {
  if (!state.sourceStats.has(name)) {
    state.sourceStats.set(name, { frames: 0, lastAt: 0, fps: 0, _window: [] });
  }
  if (!state.sourceSettings.has(name)) {
    state.sourceSettings.set(name, {
      muted: false,
      volume: 100,
      bridgeEnabled: true,
      userMuted: false,
      // T60: mixer values saved before a restart.
      ...(runtimeSettings.getMixer(name) || {}),
    });
  }
}

/** Save one source's mixer values (call after changing them). */
function persistSource(name) {
  const s = state.sourceSettings.get(name);
  if (s) runtimeSettings.saveMixer(name, s);
}

function slaveMusicActiveKey(guildId, slaveName) {
  return `${String(guildId)}:${String(slaveName)}`;
}

/** @param {boolean} active — legacy: setSlaveMusicActive(name, active) when 2 args */
function setSlaveMusicActive(guildId, slaveName, active) {
  if (arguments.length === 2 && typeof slaveName === 'boolean') {
    const n = String(guildId);
    if (slaveName) state.slaveMusicActive.add(n);
    else state.slaveMusicActive.delete(n);
    return;
  }
  const key = slaveMusicActiveKey(guildId, slaveName);
  if (active) state.slaveMusicActive.add(key);
  else state.slaveMusicActive.delete(key);
}

function isSlaveMusicActive(guildId, slaveName) {
  if (slaveName == null) {
    return state.slaveMusicActive.has(String(guildId));
  }
  return state.slaveMusicActive.has(slaveMusicActiveKey(guildId, slaveName));
}

function isSlaveMusicActiveForSource(source) {
  const { parseUserSourceKey } = require('./sourceKey');
  const parsed = parseUserSourceKey(source);
  if (parsed?.guildId) {
    return isSlaveMusicActive(parsed.guildId, parsed.slaveName);
  }
  const room = resolveSlaveRoom(source);
  if (state.slaveMusicActive.has(room)) return true;
  for (const key of state.slaveMusicActive) {
    if (key.endsWith(`:${room}`)) return true;
  }
  return false;
}

// T73 (review B2): one stats/settings entry per person per room was never removed. Drop people not
// heard for STALE_SOURCE_MS whose settings are default (a saved mute stays, it lives in runtimeSettings).
const STALE_SOURCE_MS = 7 * 24 * 3600_000;
function pruneStaleSources(now = Date.now()) {
  let n = 0;
  for (const [key, stats] of state.sourceStats) {
    if (!isUserSourceKey(key)) continue;
    if (now - (stats.lastAt || 0) < STALE_SOURCE_MS) continue;
    const s = state.sourceSettings.get(key);
    if (s && (s.userMuted || s.muted || s.volume !== 100 || s.bridgeEnabled === false)) continue;
    state.sourceStats.delete(key);
    state.sourceSettings.delete(key);
    n++;
  }
  return n;
}
setInterval(() => { try { pruneStaleSources(); } catch { /* best effort */ } }, 6 * 3600_000).unref?.();

function recordFrame(source) {
  ensureSource(source);
  const s = state.sourceStats.get(source);
  const now = Date.now();
  s.frames++;
  s.lastAt = now;
  s._window.push(now);
  const cutoff = now - 5000;
  while (s._window.length && s._window[0] < cutoff) s._window.shift();
  s.fps = Math.round((s._window.length / 5) * 10) / 10;
}

function getSourceStats(name) {
  ensureSource(name);
  return state.sourceStats.get(name);
}

function getSourceSettings(name) {
  ensureSource(name);
  const s = state.sourceSettings.get(name);
  if (s.bridgeEnabled === undefined) s.bridgeEnabled = true;
  return s;
}

function isUserBridgeMuted(sourceKey) {
  if (!isUserSourceKey(sourceKey)) return false;
  return getSourceSettings(sourceKey).userMuted === true;
}

function toggleUserBridgeMute(sourceKey) {
  const s = getSourceSettings(String(sourceKey));
  s.userMuted = !s.userMuted;
  persistSource(String(sourceKey));
  return s.userMuted;
}

/** Room-level settings key: rooms with the same name in different guilds are independent. */
function roomKey(guildId, name) {
  return guildId ? `${String(guildId)}:${String(name)}` : String(name);
}

/** Room key for a bridge source ("guild:room:user" -> "guild:room"; legacy "room:user" -> "room"). */
function roomKeyFromSource(source) {
  const parsed = parseUserSourceKey(source);
  if (parsed?.guildId) return roomKey(parsed.guildId, parsed.slaveName);
  return resolveSlaveRoom(source);
}

function isBridgeMuted(source) {
  if (isUserSourceKey(source) && getSourceSettings(source).userMuted) return true;
  const parsed = parseUserSourceKey(source);
  const guildId = parsed?.guildId || null;
  const name = parsed ? parsed.slaveName : resolveSlaveRoom(source);
  const key = roomKey(guildId, name);
  const entry = state.slaves.get(key);
  if (entry && isSlaveBridgeBlocked(entry.cfg?.channelId, entry.cfg?.guildId)) return true;
  const settings = getSourceSettings(key);
  if (settings.bridgeEnabled === false) return true;
  if (settings.muted) return true;
  const solo = getSoloSource(guildId);
  if (solo && solo !== String(name)) return true;
  return false;
}

/** Like isBridgeMuted but ignores Discord solo: web listeners choose their own room (T41). */
function isWebMuted(source) {
  if (isUserSourceKey(source) && getSourceSettings(source).userMuted) return true;
  const parsed = parseUserSourceKey(source);
  const guildId = parsed?.guildId || null;
  const name = parsed ? parsed.slaveName : resolveSlaveRoom(source);
  const settings = getSourceSettings(roomKey(guildId, name));
  return settings.bridgeEnabled === false || Boolean(settings.muted);
}

function toggleBridgeEnabled(name, guildId = null) {
  const s = getSourceSettings(roomKey(guildId, name));
  s.bridgeEnabled = !s.bridgeEnabled;
  persistSource(roomKey(guildId, name));
  return s.bridgeEnabled;
}

function soloGuildKey(guildId) {
  return guildId ? String(guildId) : '';
}

function getSoloSource(guildId = null) {
  return state.soloByGuild.get(soloGuildKey(guildId)) ?? null;
}

function isSoloActive(guildId = null) {
  return getSoloSource(guildId) != null;
}

function clearBridgeSolo(guildId = null) {
  state.soloByGuild.delete(soloGuildKey(guildId));
}

/** Toggle solo for a room; returns active solo name or null if turned off. */
function toggleBridgeSolo(name, guildId = null) {
  const n = String(name);
  if (getSoloSource(guildId) === n) {
    clearBridgeSolo(guildId);
    return null;
  }
  state.soloByGuild.set(soloGuildKey(guildId), n);
  return n;
}

function setBridgeSoloFromSelect(value, guildId = null) {
  if (!value || value === 'off') {
    clearBridgeSolo(guildId);
    return null;
  }
  state.soloByGuild.set(soloGuildKey(guildId), String(value));
  return String(value);
}

function toggleBridgeMute(name, guildId = null) {
  const s = getSourceSettings(roomKey(guildId, name));
  s.muted = !s.muted;
  persistSource(roomKey(guildId, name));
  return s.muted;
}

function setBridgeVolume(name, delta, guildId = null) {
  const s = getSourceSettings(roomKey(guildId, name));
  s.volume = Math.max(10, Math.min(200, s.volume + delta));
  persistSource(roomKey(guildId, name));
  return s.volume;
}

function setBridgeVolumeAbsolute(name, volume, guildId = null) {
  const s = getSourceSettings(roomKey(guildId, name));
  const v = Math.round(Number(volume));
  if (Number.isFinite(v)) s.volume = Math.max(10, Math.min(200, v));
  persistSource(roomKey(guildId, name));
  return s.volume;
}

/** Calls fn for each registered room (optionally one guild); returns display names. */
function forEachSlaveSource(fn, guildId = null) {
  const names = [];
  const gid = guildId ? String(guildId) : null;
  for (const [key, entry] of state.slaves) {
    if (gid && String(entry.cfg?.guildId) !== gid) continue;
    fn(key, getSourceSettings(key));
    persistSource(key);
    names.push(entry.name ?? key);
  }
  return names;
}

function muteAllBridgeSources(guildId = null) {
  return forEachSlaveSource((_key, settings) => {
    settings.muted = true;
  }, guildId);
}

function unmuteAllBridgeSources(guildId = null) {
  return forEachSlaveSource((_key, settings) => {
    settings.muted = false;
  }, guildId);
}

function resetAllBridgeVolumes(defaultVol = 100, guildId = null) {
  const v = Math.max(10, Math.min(200, Math.round(Number(defaultVol)) || 100));
  return forEachSlaveSource((_key, settings) => {
    settings.volume = v;
  }, guildId);
}

function getVolume(source) {
  return getSourceSettings(roomKeyFromSource(source)).volume / 100;
}

function registerMaster(client, hooks) {
  state.master = { client, ...hooks };
}

function getSlaveEntry(guildId, botKey) {
  const regKey = slaveRegistryKey({ guildId, name: botKey });
  if (state.slaves.has(regKey)) return state.slaves.get(regKey);
  return state.slaves.get(String(botKey)) ?? null;
}

function registerSlave(regKey, client, cfg, hooks) {
  const key = String(regKey);
  const displayName = String(cfg.name);
  state.slaves.set(key, {
    client,
    cfg,
    name: displayName,
    regKey: key,
    player: null,
    connection: null,
    ...hooks,
  });
  ensureSource(key);
}

function unregisterSlave(regKey) {
  const key = String(regKey);
  const entry = state.slaves.get(key);
  state.slaves.delete(key);
  state.sourceStats.delete(key);
  // Room mute/volume/on-off survive a slave reconnect (sourceSettings kept on purpose).
  // Solo is cleared: a solo on a room whose bot is gone would silence every other room.
  const guildId = entry?.cfg?.guildId ?? null;
  const name = entry?.name ?? key.split(':').pop();
  if (getSoloSource(guildId) === String(name)) clearBridgeSolo(guildId);
}

function setControlClient(id) {
  state.controlClientId = id;
}

function isControlBot(client) {
  return client.user?.id === state.controlClientId;
}

function canUsePanel(member) {
  if (!member) return false;
  const ids = (process.env.CONTROL_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (ids.length && ids.includes(member.id)) return true;
  // T81: owner and managers (scoped: their servers) run the panel on any server.
  try { if (member.guild?.id && require('../web/identity').isStaffFor(member.id, member.guild.id)) return true; } catch { /* ignore */ }
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function audioActivity(lastAt) {
  if (!lastAt) return { label: 'Silent', emoji: '⚫' };
  const age = Date.now() - lastAt;
  if (age < 2000) return { label: 'Live', emoji: '🟢' };
  if (age < 10000) return { label: 'Idle', emoji: '🟡' };
  return { label: 'Silent', emoji: '⚫' };
}

function getMasterSnapshot(guildId) {
  const m = state.master;
  if (!m?.client) return null;
  const c = m.client;
  const channels = getMasterChannels(guildId);
  const gid = channels.guildId || guildId;

  let conn = c.voiceConnection;
  let player = c.voicePlayer ?? c.musicPlayer;
  let paused;
  let bridgeActive = false;

  if (gid) {
    const globalVoice = require('../bots/globalVoice');
    paused = globalVoice.isGuildVoicePaused(gid);
    if (paused) {
      conn = null;
      player = null;
      bridgeActive = false;
    } else {
      const entry = globalVoice.getEntry(gid);
      if (entry) {
        conn = entry.connection;
        player = entry.player;
        bridgeActive = Boolean(entry.bridgeRelay?._tickTimer);
      } else {
        conn = null;
        player = null;
      }
    }
  } else {
    paused = Boolean(c._voiceLocker?.isPaused?.());
    bridgeActive = Boolean(c._bridgeRelay?._tickTimer);
  }

  return {
    tag: c.user?.tag ?? '—',
    connStatus: conn?.state?.status ?? 'none',
    playerStatus: player?.state?.status ?? 'none',
    channelId: channels.voiceChannelId,
    textChannelId: channels.textChannelId,
    guildId: channels.guildId,
    bridgeActive,
    paused,
  };
}

function isInSlaveVoiceChannel(member) {
  const chId = member?.voice?.channelId;
  if (!chId) return false;
  for (const entry of state.slaves.values()) {
    if (entry.cfg?.channelId === chId) return true;
  }
  return false;
}

/** People (not bots) in the slave's voice room, max 25; speaking = Discord says they talk now. */
function roomMembers(entry) {
  try {
    const c = entry?.client;
    const gid = entry?.cfg?.guildId;
    const conn = entry?.connection;
    const chId = conn?.joinConfig?.channelId || entry?.cfg?.channelId;
    if (!c || !gid || !chId) return [];
    const ch = c.guilds.cache.get(String(gid))?.channels.cache.get(String(chId));
    if (!ch?.members) return [];
    const speaking = conn?.receiver?.speaking?.users;
    const room = String(entry.name ?? entry.cfg?.name ?? '');
    return [...ch.members.values()]
      .filter(m => !m.user?.bot)
      .map(m => ({
        id: m.id,
        name: m.displayName || m.user?.globalName || m.user?.username || m.id,
        avatar: m.displayAvatarURL?.({ size: 64, extension: 'webp' }) || null,
        speaking: Boolean(speaking?.has?.(m.id)),
        muted: Boolean(m.voice?.selfMute || m.voice?.serverMute),
        // T67: muted on the bridge only (not heard in the Oud room / web), set from the panel or dashboard.
        bridgeMuted: isUserBridgeMuted(makeUserSourceKey(room, m.id, gid)),
      }))
      .sort((a, b) => Number(b.speaking) - Number(a.speaking))
      .slice(0, 100);
  } catch {
    return [];
  }
}

function isParkedOnOudRoom(cfg) {
  if (!cfg?.guildId) return false;
  try {
    const saved = require('../panel/guildChannelsStore').getSlave(cfg.guildId, cfg.name)?.voiceChannelId;
    return Boolean(saved) && saved === getMasterChannels(cfg.guildId).voiceChannelId;
  } catch { return false; }
}

function buildSlaveSnapshot(regKey, entry) {
  const c = entry?.client;
  const displayName = entry?.name ?? entry?.cfg?.name ?? String(regKey).split(':').pop();
  const key = roomKey(entry?.cfg?.guildId, displayName);
  const stats = getSourceStats(key);
  const settings = getSourceSettings(key);
  const act = audioActivity(stats.lastAt);
  const queueKey = slaveQueueKey(entry?.cfg || {
    name: displayName,
    guildId: entry?.cfg?.guildId,
  });
  const channelId = entry?.cfg?.channelId;
  const conn = entry?.connection;
  const player = entry?.player;
  return {
    name: displayName,
    regKey: String(regKey),
    tag: c?.user?.tag ?? '— (not running)',
    connStatus: conn?.state?.status ?? 'offline',
    playerStatus: player?.state?.status ?? 'none',
    channelId,
    textChannelId: entry?.cfg?.textChannelId,
    guildId: entry?.cfg?.guildId,
    muted: settings.muted,
    solo: getSoloSource(entry?.cfg?.guildId) === displayName,
    volume: settings.volume,
    fps: stats.fps,
    lastAt: stats.lastAt,
    activity: act,
    queueKey,
    paused: Boolean(entry?.voice?.isPaused?.()),
    colliding: isSlaveBridgeBlocked(channelId, entry?.cfg?.guildId),
    // T75 (review L2): saved on the Oud room on purpose (no own room yet) = parked, not an error.
    parked: isSlaveBridgeBlocked(channelId, entry?.cfg?.guildId) && isParkedOnOudRoom(entry?.cfg),
    bridgeEnabled: settings.bridgeEnabled !== false,
    pending: !c,
    members: roomMembers(entry),
  };
}

function getSlaveSnapshots(guildId = null) {
  const out = [];
  const seen = new Set();
  const filterGuild = guildId ? String(guildId) : null;

  for (const [regKey, entry] of state.slaves) {
    if (filterGuild && entry.cfg?.guildId !== filterGuild) continue;
    seen.add(String(regKey));
    out.push(buildSlaveSnapshot(regKey, entry));
  }

  try {
    const botStore = require('../panel/botStore');
    const { mergeSlaveChannelCfg } = require('../config/channels');
    for (const { name, guildId: gid } of botStore.listSlaves(filterGuild)) {
      const regKey = slaveRegistryKey({ guildId: gid, name });
      if (seen.has(regKey)) continue;
      const cfg = mergeSlaveChannelCfg({
        name,
        token: '',
        guildId: gid,
        channelId: null,
        textChannelId: null,
      });
      out.push(buildSlaveSnapshot(regKey, { cfg, client: null, name }));
    }
  } catch { /* ignore */ }

  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

module.exports = {
  pruneStaleSources,
  state,
  setSlaveMusicActive,
  isSlaveMusicActive,
  isSlaveMusicActiveForSource,
  slaveMusicActiveKey,
  recordFrame,
  getSourceStats,
  getSourceSettings,
  roomKey,
  roomKeyFromSource,
  isBridgeMuted,
  isWebMuted,
  getSoloSource,
  isSoloActive,
  clearBridgeSolo,
  toggleBridgeSolo,
  setBridgeSoloFromSelect,
  toggleBridgeMute,
  toggleUserBridgeMute,
  isUserBridgeMuted,
  toggleBridgeEnabled,
  setBridgeVolume,
  setBridgeVolumeAbsolute,
  muteAllBridgeSources,
  unmuteAllBridgeSources,
  resetAllBridgeVolumes,
  getVolume,
  roomMembers,
  registerMaster,
  registerSlave,
  unregisterSlave,
  setControlClient,
  isControlBot,
  canUsePanel,
  getMasterSnapshot,
  getSlaveSnapshots,
  getSlaveEntry,
  isInSlaveVoiceChannel,
};
