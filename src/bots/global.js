// global.js – one bot, many Discord guilds (paid whitelist)
const { Client, GatewayIntentBits } = require('discord.js');
const { attachMusicCommands } = require('../music/musicCommands');
const { attachVoiceReady } = require('../util/voiceReady');
const { discordRestOptions } = require('../util/discordClientOpts');
const applicationBootstrap = require('./applicationBootstrap');
const { applyProfile, getClientPresenceOptions } = require('../panel/botProfile');
const { attachPresenceKeeper } = require('../panel/presenceKeeper');
const registry = require('../bridge/registry');
const { attachControlPanel } = require('../panel/controlCommands');
const { attachSubsCommands } = require('../panel/subsCommands');
const subscriptionStore = require('../subscription/subscriptionStore');
const subsAdminStore = require('../subscription/subsAdminStore');
const {
  initAllowedSnapshot,
  syncSubscriptions,
  reconcileSubscriptionState,
  activateGuildSubscription,
  applySubscriptionChange,
  setSlavesSyncHandler,
} = require('../subscription/guildSubscriptionLifecycle');
const { auditSubscribedGuildRooms } = require('../subscription/guildRoomRecovery');
const { syncSubscribedSlaves } = require('../config/slaveSync');
const { shouldLeaveGuild } = require('../config/mode');
const globalVoice = require('./globalVoice');
const { attachGlobalGuildGuards } = require('./globalGuildGuard');
const guildChannelsStore = require('../panel/guildChannelsStore');
const { queueKeyForGuild } = require('../music/queueKey');
const MusicManager = require('../music/MusicManager');

const TAG = '[GLOBAL]';

function guildMembersIntentEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.GUILD_MEMBERS_INTENT?.trim() || '');
}

function buildMasterIntents() {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ];
  if (guildMembersIntentEnabled()) {
    intents.splice(1, 0, GatewayIntentBits.GuildMembers);
  }
  return intents;
}

let globalClient = null;
let slaveSyncTimer = null;
let expiryTimer = null;
let roomAuditTimer = null;
const pendingMutate = new Map();

function scheduleSlaveSync(clientTag = TAG, opts = {}) {
  if (slaveSyncTimer) clearTimeout(slaveSyncTimer);
  const defaultDelay = parseInt(process.env.BOOT_SLAVE_SYNC_DELAY_MS || '800', 10) || 800;
  const delayMs = Math.max(0, opts.delayMs ?? defaultDelay);
  slaveSyncTimer = setTimeout(() => {
    slaveSyncTimer = null;
    syncSubscribedSlaves(clientTag).catch(err => {
      console.warn(`${clientTag} Slave sync: ${err.message}`);
    });
  }, delayMs);
}

function scheduleSubscriptionApply(client, guildId) {
  const id = String(guildId);
  const prev = pendingMutate.get(id);
  if (prev) clearTimeout(prev);
  pendingMutate.set(id, setTimeout(() => {
    pendingMutate.delete(id);
    applySubscriptionChange(client, id, TAG).catch(err => {
      console.warn(`${TAG} Subscription apply failed for ${id}: ${err.message}`);
    });
  }, 80));
}

function logGuildPlan(guild) {
  const f = subscriptionStore.getGuildFeatures(guild.id);
  if (!f.allowed) return;
  const life = f.lifetime
    ? 'lifetime'
    : (f.expired ? 'expired' : (f.expires ? `until ${f.expires}` : 'timed (no expires)'));
  console.log(
    `${TAG} ${guild.name} (${guild.id}) [${f.label}]`
    + ` music=${f.music} bridge=${f.bridge} slaves=${f.slaves} autoRoom=${f.autoRoom} maxSlaves=${f.maxSlaves} (${life})`,
  );
  if (f.bridge) {
    console.log(`${TAG} Bridge relay enabled for ${guild.name} (${guild.id})`);
  }
}

async function handleGuildJoin(client, guild) {
  if (subscriptionStore.isGuildAllowed(guild.id)) {
    logGuildPlan(guild);
    await activateGuildSubscription(client, guild.id, TAG);
    return;
  }

  console.warn(`${TAG} Joined unsubscribed guild: ${guild.name} (${guild.id})`);
  if (shouldLeaveGuild(guild.id)) {
    try {
      await guild.leave();
      console.log(`${TAG} Left unknown guild ${guild.name} (${guild.id}) — not in subscriptions.json`);
    } catch (err) {
      console.warn(`${TAG} Could not leave guild ${guild.id}: ${err.message}`);
    }
  }
}

async function startBot() {
  const token = process.env.MASTER_TOKEN?.trim();
  if (!token) throw new Error('MASTER_TOKEN is required');

  subscriptionStore.seedFromEnv();
  subsAdminStore.seedFromEnv();

  async function onSubscriptionsChanged() {
    if (!globalClient) return;
    const { revoked, activated } = await syncSubscriptions(globalClient, TAG);
    for (const id of revoked) {
      const g = globalClient.guilds.cache.get(id);
      const name = g?.name ?? id;
      console.log(`${TAG} Subscription ended for ${name} (${id})`);
    }
    for (const id of activated) {
      const g = globalClient.guilds.cache.get(id);
      if (g) logGuildPlan(g);
    }
  }

  const presence = getClientPresenceOptions('master');
  if (guildMembersIntentEnabled()) {
    console.log(`${TAG} GuildMembers intent on — requires «Server Members Intent» in Discord Developer Portal`);
  } else {
    console.log(`${TAG} Subs username search: set GUILD_MEMBERS_INTENT=1 in .env after enabling Server Members Intent in portal`);
  }
  const client = attachVoiceReady(new Client({
    intents: buildMasterIntents(),
    ...discordRestOptions(),
    ...(presence ? { presence } : {}),
  }));
  attachPresenceKeeper(client, 'master', TAG);

  async function bootStep(name, fn) {
    try { return await fn(); } catch (err) {
      console.error(`${TAG} Boot step "${name}" failed: ${err?.stack || err?.message || err}`);
      return undefined;
    }
  }

  client.once('clientReady', async () => {
    console.log(`${TAG} Logged in as ${client.user.tag} (+${process.uptime().toFixed(1)}s)`);
    await bootStep('ensureGatewayInteractions', () => applicationBootstrap.ensureGatewayInteractions(client, TAG));
    await bootStep('applyProfile', () => applyProfile(client, 'master', TAG, { presenceOnly: true }));

    await bootStep('attach handlers', () => {
      attachMusicCommands(client);
      registry.registerMaster(client, {});
      attachControlPanel(client);
      attachSubsCommands(client);
      globalVoice.setGuardClient(client);
      globalClient = client;
      setSlavesSyncHandler(() => scheduleSlaveSync(TAG, { delayMs: 0 }));
      subscriptionStore.setMutateListener((guildId) => {
        scheduleSubscriptionApply(client, guildId);
      });
      initAllowedSnapshot();
    });

    await bootStep('syncSubscriptions', () => syncSubscriptions(client, TAG, { skipSlaveSync: true }));
    // Rooms repaired first so slaves never fall back to a stale master room, then slaves log in
    // while the master finishes labels/watchers/guards (was: after everything).
    // T56: cap the wait so one guild that cannot join voice never holds back the slaves.
    const auditCapMs = parseInt(process.env.BOOT_AUDIT_CAP_MS || '45000', 10) || 45000;
    let auditTimer = null;
    const auditCap = new Promise(r => { auditTimer = setTimeout(() => { console.warn(`${TAG} Room audit still running after ${auditCapMs / 1000}s — starting slaves`); r(); }, auditCapMs); });
    await bootStep('auditSubscribedGuildRooms', () => Promise.race([auditSubscribedGuildRooms(client, TAG), auditCap]));
    clearTimeout(auditTimer);
    scheduleSlaveSync(TAG, { delayMs: 0 });
    await bootStep('syncAllGuildLabels', () => subscriptionStore.syncAllGuildLabels(client));
    await bootStep('startWatching', () => subscriptionStore.startWatching(onSubscriptionsChanged));
    await bootStep('attachGlobalGuildGuards', () => attachGlobalGuildGuards(client));

    client.markVoiceReady?.();

    const allowed = subscriptionStore.listGuildIds();
    console.log(`${TAG} Active subscriptions: ${allowed.length} guild(s)`);
    console.log(`[BOOT] master ready +${process.uptime().toFixed(1)}s`);
    await bootStep('dashboard', () => {
      const web = require('../web/server');
      web.attachDiscord(client);
      require('../web/api').markBoot('master');
    });
    for (const id of allowed) {
      const g = client.guilds.cache.get(id);
      if (g) logGuildPlan(g);
    }

    expiryTimer = setInterval(() => {
      if (!globalClient) return;
      reconcileSubscriptionState(globalClient, TAG).catch(err => {
        console.warn(`${TAG} Subscription expiry check error: ${err.message}`);
      });
    }, 60_000);

    // Opt-in DM to server owners before a timed subscription ends (EXPIRY_REMINDERS=1).
    const expiryReminder = require('../subscription/expiryReminder');
    if (expiryReminder.enabled()) {
      const remind = () => expiryReminder.run(globalClient).catch(err => console.warn(`${TAG} Expiry reminder error: ${err.message}`));
      setTimeout(remind, 120_000).unref?.();
      setInterval(remind, 3_600_000).unref?.();
      console.log(`${TAG} Expiry reminders on (days: ${expiryReminder.thresholds().join(',')})`);
    }

    const roomAuditMs = Math.max(
      60_000,
      parseInt(process.env.ROOM_AUDIT_INTERVAL_MS || '300000', 10) || 300000,
    );
    roomAuditTimer = setInterval(() => {
      if (!globalClient) return;
      auditSubscribedGuildRooms(globalClient, TAG).catch(err => {
        console.warn(`${TAG} Room audit error: ${err.message}`);
      });
    }, roomAuditMs);
    console.log(`${TAG} Room health audit every ${roomAuditMs / 1000}s`);
    require('../panel/ownerNotice').attachOwnerNoticeWatch(client, TAG);
    require('../panel/broadcastPlan').start(() => globalClient);

    guildChannelsStore.startWatching(async () => {
      try {
        if (!globalClient) return;
        const { syncGlobalGuildRoom } = require('../music/musicCommands');
        for (const id of subscriptionStore.listGuildIds()) {
          syncGlobalGuildRoom(id);
        }
        await auditSubscribedGuildRooms(globalClient, TAG);
        scheduleSlaveSync(TAG);
      } catch (err) {
        console.warn(`${TAG} guildChannels watch failed: ${err.message}`);
      }
    });
  });

  client.on('guildCreate', (guild) => handleGuildJoin(client, guild).catch(err =>
    console.warn(`${TAG} guildCreate handling failed for ${guild.id}: ${err.message}`)));
  client.on('guildUpdate', (oldGuild, newGuild) => {
    if (oldGuild.name !== newGuild.name) {
      subscriptionStore.syncGuildLabel(newGuild);
    }
  });
  client.on('guildDelete', (guild) => {
    globalVoice.destroyGuildVoice(guild.id);
    MusicManager.haltGuildPlayback(queueKeyForGuild(guild.id)).catch(() => {});
    console.log(`${TAG} Left guild ${guild.name} (${guild.id})`);
  });

  client.on('error', (err) => {
    if (err?.name === 'AbortError') return;
    console.error(`${TAG} Client error:`, err.stack || err.message);
  });

  await client.login(token);
  return client;
}

async function shutdown(tag = TAG) {
  if (slaveSyncTimer) {
    clearTimeout(slaveSyncTimer);
    slaveSyncTimer = null;
  }
  for (const timer of pendingMutate.values()) clearTimeout(timer);
  pendingMutate.clear();
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
  if (roomAuditTimer) {
    clearInterval(roomAuditTimer);
    roomAuditTimer = null;
  }
  try { subscriptionStore.setMutateListener(null); } catch { /* ignore */ }
  await MusicManager.haltAllPlayback();
  globalVoice.destroyAllGuildVoice();
  const registry = require('../bridge/registry');
  for (const entry of registry.state.slaves.values()) {
    try { entry.voice?.destroy?.(); } catch { /* ignore */ }
  }
  if (globalClient) {
    try { await globalClient.destroy(); } catch { /* ignore */ }
    globalClient = null;
  }
  console.log(`${tag} Shutdown complete`);
}

module.exports = { startBot, shutdown, getClient: () => globalClient };
