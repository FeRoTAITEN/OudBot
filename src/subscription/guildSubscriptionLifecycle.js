// Subscription active ↔ expired: bootstrap rooms or leave voice + halt commands
const subscriptionStore = require('./subscriptionStore');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { bootstrapGuildRooms } = require('./guildRoomBootstrap');
const { repairGuildMasterRoom } = require('./guildRoomRecovery');
const globalVoice = require('../bots/globalVoice');
const { cancelGuildVoiceGuard } = require('../bots/globalGuildGuard');
const MusicManager = require('../music/MusicManager');
const { queueKeyForGuild } = require('../music/queueKey');
const { shouldLeaveGuild } = require('../config/mode');
const { syncGuildBridgeRuntime, reattachGuildBridge } = require('../bots/globalBridge');
const { resyncSlaveBridgeForGuild, waitForGuildSlaveBridgeReady } = require('../bots/slave');
const { disconnectAllGuildSlaves } = require('../config/removeSlave');
const { runPool } = require('../util/runPool');

const TAG = '[SUB]';
const BOOT_GUILD_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.BOOT_GUILD_CONCURRENCY || '6', 10) || 6,
);
const BRIDGE_READY_MS = Math.max(
  500,
  parseInt(process.env.SUBS_BRIDGE_READY_MS || '3000', 10) || 3000,
);
const BRIDGE_WARMUP_MS = Math.max(
  0,
  parseInt(process.env.SUBS_BRIDGE_WARMUP_MS || '100', 10) || 100,
);

let lastAllowedGuildIds = new Set();
let lastGuildBridge = new Map();
let reconcileInflight = null;
let onSlavesSyncNeeded = null;

function setSlavesSyncHandler(fn) {
  onSlavesSyncNeeded = fn;
}

function requestSlaveSync() {
  if (onSlavesSyncNeeded) {
    Promise.resolve(onSlavesSyncNeeded()).catch(err => {
      console.warn(`${TAG} Slave sync hook failed: ${err.message}`);
    });
  }
}

function snapshotGuildBridge() {
  const map = new Map();
  for (const id of subscriptionStore.listAllGuildIds()) {
    const f = subscriptionStore.getGuildFeatures(id);
    map.set(id, Boolean(f.allowed && f.bridge));
  }
  return map;
}

function guildBridgeEnabled(guildId) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  return Boolean(f.allowed && f.bridge);
}

async function syncGuildBridgeForGuild(client, guildId, tag = TAG) {
  const id = String(guildId);
  const was = lastGuildBridge.get(id) ?? false;
  const now = guildBridgeEnabled(id);
  if (was === now) return false;

  if (now) {
    const { refreshed, total } = await resyncSlaveBridgeForGuild(id);
    const ready = await waitForGuildSlaveBridgeReady(id, BRIDGE_READY_MS);
    const g = client.guilds.cache.get(id);
    const name = g?.name ?? id;
    if (!ready) {
      console.warn(
        `${tag} Bridge enable for ${name} (${id}): slaves not all ready`
        + ` (${refreshed}/${total} refreshed) — starting relay anyway`,
      );
    } else {
      console.log(`${tag} Bridge slaves ready for ${name} (${id}) (${refreshed}/${total})`);
    }
    reattachGuildBridge(id, { warmupMs: BRIDGE_WARMUP_MS });
  } else {
    await resyncSlaveBridgeForGuild(id);
    syncGuildBridgeRuntime(id);
  }

  lastGuildBridge.set(id, now);
  const g = client.guilds.cache.get(id);
  const name = g?.name ?? id;
  console.log(`${tag} Bridge ${now ? 'enabled' : 'disabled'} for ${name} (${id})`);
  return true;
}

async function syncGuildBridgeChanges(client, tag = '[GLOBAL]') {
  const current = snapshotGuildBridge();
  const ids = new Set([...lastGuildBridge.keys(), ...current.keys()]);

  for (const id of ids) {
    try {
      await syncGuildBridgeForGuild(client, id, tag);
    } catch (err) {
      console.warn(`${TAG} Bridge change failed for ${id}: ${err.message}`);
    }
  }

  lastGuildBridge = current;
}

function snapshotAllowedGuilds() {
  return new Set(subscriptionStore.listGuildIds());
}

async function resolveGuild(client, guildId) {
  const cached = client.guilds.cache.get(guildId);
  if (cached) return cached;
  return client.guilds.fetch(guildId).catch(() => null);
}

async function revokeGuildSubscription(client, guildId) {
  const id = String(guildId);
  const key = queueKeyForGuild(id);
  const f = subscriptionStore.getGuildFeatures(id);
  cancelGuildVoiceGuard(id);
  globalVoice.clearGuildVoicePause(id);
  await MusicManager.haltGuildPlayback(key);
  globalVoice.destroyGuildVoice(id);
  await disconnectAllGuildSlaves(id, TAG);
  const why = f.expired ? 'expired' : (f.active === false ? 'active=false' : 'removed');
  if (f.expired) void notifyPlanExpired(client, id, f).catch(() => {});
  console.log(`${TAG} Subscription off (${why}) — master + slaves left voice for guild ${id}`);
}

/** T63: one message in the Oud room chat when a timed plan ends (bot stays for the grace period). */
async function notifyPlanExpired(client, guildId, f) {
  const { graceUntil } = require('../config/mode');
  const until = graceUntil(guildId);
  if (!until) return;
  if (!require('../util/runtimeSettings').claimNotice(`expired:${guildId}:${f.expires}`)) return;
  const guild = client.guilds.cache.get(String(guildId));
  const textId = guildChannelsStore.getMaster(guildId)?.textChannelId;
  const ch = textId ? guild?.channels?.cache?.get(textId) : null;
  if (!ch?.isTextBased?.()) return;
  const { createTranslator } = require('../i18n');
  const lang = String(guild.preferredLocale || '').startsWith('en') ? 'en' : 'ar';
  const t = createTranslator(lang);
  const contact = process.env.DEFAULT_CONTACT_URL?.trim();
  const text = t('sub.expiredNotice', { date: `<t:${Math.floor(until / 1000)}:F>`, rel: `<t:${Math.floor(until / 1000)}:R>` })
    + (contact ? `\n${t('sub.renewContact', { url: contact })}` : '');
  await ch.send(text).catch(() => {});
  console.log(`${TAG} Plan expired notice sent in ${guild.name} (stays until ${new Date(until).toISOString()})`);
}

async function activateGuildSubscription(client, guildId, tag = '[GLOBAL]') {
  const id = String(guildId);
  const guild = await resolveGuild(client, id);
  if (!guild) {
    console.warn(`${tag} Guild ${id} subscribed but Oud is not in that server — invite the bot, then save subscriptions.json again`);
    return false;
  }
  guildChannelsStore.ensureGuildEntry(id);
  subscriptionStore.syncGuildLabel(guild);
  await bootstrapGuildRooms(client, id, tag);
  return repairGuildMasterRoom(client, id, tag);
}

async function auditUnsubscribedGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    if (subscriptionStore.isGuildAllowed(guild.id)) continue;
    if (!globalVoice.getEntry(guild.id) && !globalVoice.isGuildVoiceHealthy(guild.id)) {
      if (shouldLeaveGuild(guild.id)) {
        try {
          await guild.leave();
          console.log(`${TAG} Left unsubscribed guild ${guild.name} (${guild.id})`);
        } catch (err) {
          console.warn(`${TAG} Could not leave guild ${guild.id}: ${err.message}`);
        }
      }
      continue;
    }
    await revokeGuildSubscription(client, guild.id);
    if (shouldLeaveGuild(guild.id)) {
      try {
        await guild.leave();
        console.log(`${TAG} Left unsubscribed guild ${guild.name} (${guild.id})`);
      } catch (err) {
        console.warn(`${TAG} Could not leave guild ${guild.id}: ${err.message}`);
      }
    }
  }
}

/** Apply one subs.json change immediately (panel toggle, on/off, remove). */
async function applySubscriptionChange(client, guildId, tag = TAG) {
  const id = String(guildId);
  const allowedNow = subscriptionStore.isGuildAllowed(id);
  const wasAllowed = lastAllowedGuildIds.has(id);
  let slavesSync = false;

  if (wasAllowed && !allowedNow) {
    await revokeGuildSubscription(client, id);
    lastAllowedGuildIds.delete(id);
    lastGuildBridge.set(id, false);
    return { revoked: true, activated: false, guildId: id };
  }

  if (!wasAllowed && allowedNow) {
    await activateGuildSubscription(client, id, tag);
    lastAllowedGuildIds.add(id);
    lastGuildBridge.set(id, guildBridgeEnabled(id));
    requestSlaveSync();
    return { revoked: false, activated: true, guildId: id };
  }

  if (!allowedNow) {
    lastGuildBridge.set(id, false);
    return { revoked: false, activated: false, guildId: id };
  }

  if (!subscriptionStore.guildHasSlaves(id)) {
    await disconnectAllGuildSlaves(id, tag);
  } else {
    slavesSync = true;
  }

  await syncGuildBridgeForGuild(client, id, tag);
  if (slavesSync) requestSlaveSync();

  return { revoked: false, activated: false, guildId: id };
}

async function reconcileSubscriptionStateImpl(client, tag = '[GLOBAL]') {
  const current = snapshotAllowedGuilds();
  const revoked = [...lastAllowedGuildIds].filter(id => !current.has(id));
  const activated = [...current].filter(id => !lastAllowedGuildIds.has(id));

  for (const id of revoked) {
    try {
      await revokeGuildSubscription(client, id);
    } catch (err) {
      console.warn(`${TAG} Revoke failed for ${id}: ${err.message}`);
    }
  }

  const activationResults = await runPool(activated, BOOT_GUILD_CONCURRENCY, (id) =>
    activateGuildSubscription(client, id, tag),
  );
  activationResults.forEach((r, i) => {
    if (r && r.error) {
      console.warn(`${TAG} Activate failed for ${activated[i]}: ${r.error.message}`);
    }
  });

  try {
    await auditUnsubscribedGuilds(client);
  } catch (err) {
    console.warn(`${TAG} Audit unsubscribed guilds failed: ${err.message}`);
  }
  try {
    await syncGuildBridgeChanges(client, tag);
  } catch (err) {
    console.warn(`${TAG} Bridge sync failed: ${err.message}`);
  }

  lastAllowedGuildIds = current;

  return { revoked, activated };
}

function reconcileSubscriptionState(client, tag = '[GLOBAL]') {
  const base = (reconcileInflight || Promise.resolve()).catch(() => {});
  const run = base.then(() => reconcileSubscriptionStateImpl(client, tag));
  const tracked = run.finally(() => {
    if (reconcileInflight === tracked) reconcileInflight = null;
  }).catch(() => {});
  reconcileInflight = tracked;
  return run;
}

async function syncSubscriptions(client, tag = '[GLOBAL]', opts = {}) {
  await subscriptionStore.reloadWithRetry();
  const result = await reconcileSubscriptionState(client, tag);
  if (!opts.skipSlaveSync) requestSlaveSync();
  return result;
}

function initAllowedSnapshot() {
  subscriptionStore.reload();
  lastAllowedGuildIds = snapshotAllowedGuilds();
  lastGuildBridge = snapshotGuildBridge();
}

module.exports = {
  initAllowedSnapshot,
  syncSubscriptions,
  reconcileSubscriptionState,
  applySubscriptionChange,
  revokeGuildSubscription,
  activateGuildSubscription,
  syncGuildBridgeChanges,
  syncGuildBridgeForGuild,
  auditUnsubscribedGuilds,
  setSlavesSyncHandler,
};
