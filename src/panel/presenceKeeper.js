const { Events } = require('discord.js');
const profileStore = require('./profileStore');
const { applyPresenceFromSaved } = require('./botProfile');

const KEEP_INTERVAL_MS = 5 * 60 * 1000;

function attachPresenceKeeper(client, botKey, tag = '[PROFILE]') {
  const key = String(botKey);
  const refresh = async (reason = '') => {
    const saved = profileStore.get(key);
    if (!client?.user) return;
    if (!saved) return;
    const hasPresence = (saved.activityType && saved.activityType !== 'none')
      || (saved.presenceStatus && saved.presenceStatus !== 'online');
    if (!hasPresence) return;
    try {
      applyPresenceFromSaved(client, saved);
      if (reason) {
        console.log(`${tag} Presence refreshed (${reason}) for **${key}**`);
      }
    } catch (err) {
      console.warn(`${tag} Presence refresh failed for **${key}**:`, err.message);
    }
  };

  client._refreshPresence = refresh;

  client.on(Events.ClientReady, () => refresh('ready'));
  client.on(Events.ShardReady, () => refresh('shard'));

  const timer = setInterval(() => refresh('interval'), KEEP_INTERVAL_MS);
  timer.unref?.();

  const cleanup = () => clearInterval(timer);
  client.once('destroy', cleanup);

  return { refresh, cleanup };
}

module.exports = { attachPresenceKeeper, KEEP_INTERVAL_MS };
