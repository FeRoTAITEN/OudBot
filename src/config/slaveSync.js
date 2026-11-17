const startSlave = require('../bots/slave');
const registry = require('../bridge/registry');
const subscriptionStore = require('../subscription/subscriptionStore');
const { loadSlaveConfigs } = require('./loadSlaves');
const { mergeSlaveChannelCfg } = require('./channels');
const { slaveRegistryKey } = require('../music/slaveQueueKey');
const { clearInteractionEndpoint } = require('../bots/clearInteractionEndpoint');
const { runPool } = require('../util/runPool');

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const BOOT_SLAVE_DELAY_MS = Math.max(
  0,
  parseInt(process.env.BOOT_SLAVE_DELAY_MS || '0', 10) || 0,
);
const BOOT_SLAVE_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.BOOT_SLAVE_CONCURRENCY || '6', 10) || 6,
);

let syncInFlight = null;

/**
 * Start saved slave bots for guilds with slaves:true (GLOBAL hot-sync + boot helper).
 */
async function syncSubscribedSlaves(tag = '[SLAVES]') {
  if (syncInFlight) return syncInFlight;

  syncInFlight = syncSubscribedSlavesImpl(tag).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function syncSubscribedSlavesImpl(tag = '[SLAVES]') {
  const configs = loadSlaveConfigs();
  const started = [];
  const skipped = [];
  const pending = [];

  for (const raw of configs) {
    const gid = raw.guildId;
    if (!gid || !subscriptionStore.isGuildAllowed(gid)) {
      skipped.push({ name: raw.name, reason: 'not_subscribed' });
      continue;
    }
    if (!subscriptionStore.guildHasSlaves(gid)) {
      skipped.push({ name: raw.name, reason: 'slaves_off' });
      continue;
    }

    const cfg = mergeSlaveChannelCfg(raw);
    const regKey = slaveRegistryKey(cfg);
    if (registry.state.slaves.has(regKey)) {
      skipped.push({ name: raw.name, reason: 'already_running' });
      continue;
    }

    if (!cfg.channelId) {
      skipped.push({ name: raw.name, reason: 'no_room' });
      continue;
    }

    const guildCount = [...registry.state.slaves.values()]
      .filter(e => String(e.cfg?.guildId) === String(gid)).length;
    const max = subscriptionStore.getMaxSlavesForGuild(gid);
    if (guildCount >= max) {
      skipped.push({ name: raw.name, reason: 'max_slaves' });
      continue;
    }

    pending.push(raw);
  }

  // One REST check per distinct token, all at once (was serial: ~0.3 s x tokens before any slave started).
  const byToken = new Map();
  for (const raw of pending) {
    const token = raw.token?.trim();
    if (token && !byToken.has(token)) byToken.set(token, raw.name);
  }
  await Promise.all([...byToken].map(([token, name]) =>
    clearInteractionEndpoint(token, `[SLAVE:${name}]`).catch(() => {})));

  await runPool(pending, BOOT_SLAVE_CONCURRENCY, async (raw) => {
    const gid = raw.guildId;
    const cfg = mergeSlaveChannelCfg(raw);

    try {
      const client = await startSlave(cfg);
      await client.whenVoiceReady;
      started.push({ name: raw.name, guildId: gid });
      console.log(`${tag} Started slave #${raw.name} for guild ${gid}`);
      if (BOOT_SLAVE_DELAY_MS > 0) await delay(BOOT_SLAVE_DELAY_MS);
    } catch (err) {
      console.error(`${tag} Slave #${raw.name} failed: ${err.message}`);
      skipped.push({ name: raw.name, reason: err.message });
    }
  });

  if (started.length) {
    const voiceReady = started.filter(({ name, guildId }) => {
      const entry = registry.getSlaveEntry(guildId, name);
      return entry?.connection?.state?.status === 'ready';
    }).length;
    console.log(`${tag} ${started.length} slave(s) started (${voiceReady} in voice)`);
    console.log(`[BOOT] slaves ready +${process.uptime().toFixed(1)}s (${started.length})`);
    try { require('../web/api').markBoot?.('slaves'); } catch { /* dashboard optional */ }
  }

  return { started, skipped };
}

module.exports = { syncSubscribedSlaves };
