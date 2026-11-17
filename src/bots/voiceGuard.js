// voiceGuard.js – single rejoin path (no overlapping join/destroy loops)
const { getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const { safeListener } = require('../util/safeListener');
const runtimeSettings = require('../util/runtimeSettings');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const REJOIN_MAX_ATTEMPTS = Math.max(
  1,
  parseInt(process.env.VOICE_REJOIN_MAX_ATTEMPTS || '12', 10) || 12,
);
const REJOIN_BASE_DELAY_MS = Math.max(
  1000,
  parseInt(process.env.VOICE_REJOIN_BASE_DELAY_MS || '5000', 10) || 5000,
);
const REJOIN_MAX_DELAY_MS = Math.max(
  REJOIN_BASE_DELAY_MS,
  parseInt(process.env.VOICE_REJOIN_MAX_DELAY_MS || '60000', 10) || 60_000,
);

function rejoinBackoffMs(failureCount) {
  const exp = Math.max(0, Math.min(failureCount - 1, 6));
  return Math.min(REJOIN_BASE_DELAY_MS * (2 ** exp), REJOIN_MAX_DELAY_MS);
}
const BRIDGE_REFRESH_SETTLE_MS = Math.max(
  200,
  parseInt(process.env.BRIDGE_REFRESH_SETTLE_MS || '500', 10) || 500,
);

function createVoiceLocker({ guildId, channelId: initialChannelId, group, tag, onGiveUp = null }) {
  let channelId = String(initialChannelId);
  let joinPromise = null;
  let debounceTimer = null;
  let cooldownUntil = 0;
  let joinFn = null;
  let guardArmed = false;
  // T60: a room bot paused before a restart stays paused.
  let paused = runtimeSettings.isSlavePaused(guildId, group);
  let rejoinFailures = 0;
  let rejoinGaveUp = false;
  let disposed = false;
  let attachedClient = null;
  let stateHandler = null;

  function setChannelId(id) {
    channelId = String(id);
  }

  function setJoinFn(fn) {
    joinFn = fn;
  }

  function disconnect() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    guardArmed = false;
    try {
      getVoiceConnection(guildId, group)?.destroy();
    } catch { /* ignore */ }
  }

  function destroy() {
    disposed = true;
    joinFn = null;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    disconnect();
    if (attachedClient && stateHandler) {
      attachedClient.off('voiceStateUpdate', stateHandler);
      attachedClient = null;
      stateHandler = null;
    }
  }

  function isPaused() {
    return paused;
  }

  function isOnTargetChannel() {
    const conn = getVoiceConnection(guildId, group);
    return conn?.joinConfig?.channelId === channelId
      && conn.state.status === VoiceConnectionStatus.Ready;
  }

  let joining = false;

  function isJoining() {
    return joining || Boolean(joinPromise);
  }

  function pause() {
    paused = true;
    runtimeSettings.setSlavePaused(guildId, group, true);
    guardArmed = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    disconnect();
    console.log(`${tag} Voice paused — will not auto-rejoin until resumed`);
  }

  async function resume() {
    if (disposed) return;
    if (!paused) return;
    paused = false;
    runtimeSettings.setSlavePaused(guildId, group, false);
    rejoinFailures = 0;
    rejoinGaveUp = false;
    await runJoin();
    arm();
    console.log(`${tag} Voice resumed`);
  }

  function scheduleRejoin(reason, { force = false } = {}) {
    if (disposed) return;
    if (paused) return;
    if (!joinFn) return;
    if (rejoinGaveUp && !force) return;
    if (force || reason !== 'retry') {
      rejoinFailures = 0;
      rejoinGaveUp = false;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    // Defer instead of dropping — a request during cooldown or while a join
    // is in flight must still run later, or a deleted-room rejoin gets lost.
    const wait = Math.max(4000, cooldownUntil - Date.now());
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (paused) return;
      if (joinPromise) {
        joinPromise.catch(() => {}).finally(() => scheduleRejoin(reason, { force }));
        return;
      }
      runRejoin(reason, { force }).catch(() => {});
    }, wait);
  }

  async function runRejoin(reason, { force = false } = {}) {
    if (disposed || !joinFn || joinPromise) return;
    // A deferred rejoin may fire after the connection already recovered.
    if (!force && isOnTargetChannel()) return;

    console.log(`${tag} Rejoining voice room (${reason})...`);
    let failed = false;
    joinPromise = (async () => {
      joining = true;
      disconnect();
      const settleMs = String(reason).includes('bridge refresh')
        ? BRIDGE_REFRESH_SETTLE_MS
        : 2500;
      await sleep(settleMs);
      await joinFn();
    })();
    try {
      await joinPromise;
      cooldownUntil = Date.now() + 8000;
      rejoinFailures = 0;
      rejoinGaveUp = false;
    } catch (err) {
      failed = true;
      console.error(`${tag} Rejoin failed:`, err.message);
    } finally {
      joining = false;
      joinPromise = null;
    }
    // Retry only after joinPromise is cleared — scheduling it inside the
    // catch block above made scheduleRejoin drop the retry every time.
    if (failed && !paused) {
      rejoinFailures += 1;
      if (rejoinFailures >= REJOIN_MAX_ATTEMPTS) {
        rejoinGaveUp = true;
        console.error(
          `${tag} Voice rejoin stopped after ${rejoinFailures} failed attempt(s) — `
          + 'trying Master room fallback',
        );
        if (onGiveUp) {
          Promise.resolve(onGiveUp(reason)).catch(err => {
            console.warn(`${tag} Master fallback after give-up failed: ${err.message}`);
          });
        }
        return;
      }
      const delay = rejoinBackoffMs(rejoinFailures);
      cooldownUntil = Date.now() + delay;
      console.warn(`${tag} Voice rejoin retry ${rejoinFailures}/${REJOIN_MAX_ATTEMPTS} in ${delay}ms`);
      await sleep(delay);
      if (disposed) return;
      scheduleRejoin('retry');
    }
  }

  async function runJoin() {
    if (disposed) return;
    if (!joinFn) return;
    if (isOnTargetChannel()) return;
    if (joinPromise) return joinPromise;
    joinPromise = (async () => {
      joining = true;
      try {
        await joinFn();
        cooldownUntil = Date.now() + 8000;
      } finally {
        joining = false;
        joinPromise = null;
      }
    })();
    return joinPromise;
  }

  function arm() {
    guardArmed = true;
  }

  function attach(client) {
    if (disposed) return;
    if (attachedClient && stateHandler) {
      attachedClient.off('voiceStateUpdate', stateHandler);
    }
    attachedClient = client;
    stateHandler = safeListener(tag, (_old, state) => {
      if (disposed || paused || !guardArmed || joining) return;
      if (!client.user || state.member?.id !== client.user.id) return;
      if (state.guild?.id !== guildId) return;
      if (state.channelId === channelId) return;
      scheduleRejoin(`left assigned channel (${state.channelId ?? 'none'})`);
    });
    client.on('voiceStateUpdate', stateHandler);
  }

  async function promptRejoin(reason = 'manual reconnect') {
    if (disposed) return false;
    if (paused || !joinFn) return false;
    rejoinFailures = 0;
    rejoinGaveUp = false;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    cooldownUntil = 0;
    try {
      await runRejoin(reason, { force: true });
    } catch { /* ignore */ }
    return isOnTargetChannel();
  }

  async function waitForTargetChannel(timeoutMs = 35_000) {
    if (isOnTargetChannel()) return true;
    if (!paused && joinFn && !joinPromise) {
      await promptRejoin('room assign');
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isOnTargetChannel()) return true;
      if (joinPromise) {
        try {
          await Promise.race([joinPromise, sleep(1000)]);
        } catch { /* ignore */ }
      } else if (!paused && joinFn && !joining) {
        await runJoin().catch(() => {});
      }
      await sleep(500);
    }
    return isOnTargetChannel();
  }

  return {
    attach,
    arm,
    scheduleRejoin,
    promptRejoin,
    waitForTargetChannel,
    runJoin,
    setJoinFn,
    destroy,
    setChannelId,
    pause,
    resume,
    isPaused,
    isOnTargetChannel,
    isJoining,
  };
}

module.exports = { createVoiceLocker };
