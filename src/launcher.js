// launcher.js – master bot + subscribed slaves (multi-guild)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('./util/consoleStamp').install();
// T82: a restore picked in the dashboard is applied before any store reads its file.
require('./util/dataBackup').applyPendingRestore(path.join(__dirname, '..', 'data'));
require('./util/voicePorts').install(); // T56: fixed voice UDP ports for the PletX rule
require('./util/runtimeSettings').enable(); // T60: saved mixer/pause state (off in checks and tools)
// Dashboard log tail (ring buffer, secrets redacted) — must wrap console before anything logs.
require('./web/logBuffer').install();

const { startBot, shutdown } = require('./bots/global');
const { clearInteractionEndpoint } = require('./bots/clearInteractionEndpoint');
const { resolveGuildId } = require('./config/channels');
const guildChannelsStore = require('./panel/guildChannelsStore');
const botStore = require('./panel/botStore');
const subscriptionStore = require('./subscription/subscriptionStore');
const subsAdminStore = require('./subscription/subsAdminStore');
const { isRecoverableNetworkError } = require('./util/networkError');
const { scheduleYtdlpUpdate } = require('./music/ytdlpUpdater');
const { createLogger } = require('./util/logger');

const log = createLogger('LAUNCHER');

console.log(`[LAUNCHER] build=20250628-multi pid=${process.pid}`);

subscriptionStore.seedFromEnv();
subsAdminStore.seedFromEnv();
require('./web/ownerStore').seedOnce(); // T82
subscriptionStore.reload();

for (const guildId of subscriptionStore.listGuildIds()) {
  guildChannelsStore.migrateLegacy(guildId);
  guildChannelsStore.ensureGuildEntry(guildId);
}

const bootGuildId = resolveGuildId();
if (bootGuildId) {
  guildChannelsStore.seedGuildFromEnv(bootGuildId);
}
guildChannelsStore.startWatching();
botStore.migrateLegacy();
require('./util/dataBackup').scheduleDataBackups(path.join(__dirname, '..', 'data'));

if (!process.env.MASTER_TOKEN?.trim()) {
  console.error('❌ MASTER_TOKEN is required');
  process.exit(1);
}

let shuttingDown = false;

async function gracefulShutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${reason} — shutting down…`);
  try { require('./web/server').stop(); } catch { /* ignore */ }
  // Save the queues before the bots tear them down (restored on next boot).
  try { require('./music/queuePersist').save(require('./music/MusicManager')); } catch { /* ignore */ }
  try { require('./util/runtimeSettings').flush(); } catch { /* ignore */ }
  try {
    await shutdown('[LAUNCHER]');
  } catch (err) {
    log.error('Shutdown error:', err.message || err);
  }
  process.exit(code);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM', 0); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT', 0); });

process.on('uncaughtException', (err) => {
  if (isRecoverableNetworkError(err)) {
    log.warn('Recovered network error:', err.message);
    return;
  }
  log.error('Uncaught:', err.stack || err.message);
  void gracefulShutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (err) => {
  if (err?.message?.includes('Cannot perform IP discovery - socket closed')) return;
  if (isRecoverableNetworkError(err)) {
    log.warn('Recovered network rejection:', err.message);
    return;
  }
  log.error('Rejection:', err);
});

/** Bring back the songs that were playing before the restart (bots resume them when they rejoin voice). */
function restoreQueues() {
  try {
    const MM = require('./music/MusicManager');
    const persist = require('./music/queuePersist');
    const subs = require('./subscription/subscriptionStore');
    const { parseSlaveQueueKey } = require('./music/slaveQueueKey');
    const guildIdOf = (k) => (String(k).startsWith('guild:') ? String(k).slice(6) : parseSlaveQueueKey(String(k))?.guildId ?? null);
    persist.restore(MM, { isAllowed: (gid) => subs.isGuildAllowed(gid), guildIdOf });
    // Chat channel through the bot that owns the room (slave key -> that slave's client).
    const resolveChannel = (key, channelId) => {
      const slave = parseSlaveQueueKey(String(key));
      const registry = require('./bridge/registry');
      const client = slave ? registry.getSlaveEntry(slave.guildId, slave.name)?.client : registry.state.master?.client;
      return client?.channels?.cache?.get(channelId) ?? null;
    };
    persist.start(MM, { resolveChannel });
  } catch (err) {
    log.warn('Queue restore failed:', err.message);
  }
}

(async () => {
  try {
    scheduleYtdlpUpdate('[LAUNCHER]');
    // Dashboard comes up immediately (same port as the panel allocation), before Discord login.
    try { require('./web/server').start(); } catch (err) { log.warn('Dashboard start failed:', err.message); }
    await clearInteractionEndpoint(process.env.MASTER_TOKEN, '[BOT]');
    restoreQueues();
    const client = await startBot();
    await client.whenVoiceReady;
    log.info('Running — edit data/subscriptions.json live');
  } catch (err) {
    log.error('Fatal error:', err);
    process.exit(1);
  }
})();
