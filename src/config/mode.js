const subscriptionStore = require('../subscription/subscriptionStore');

function unpaidGuildAction() {
  const v = process.env.UNPAID_GUILD_ACTION?.trim().toLowerCase();
  if (v === 'stay') return 'stay';
  if (v === 'leave-unknown') return 'leave-unknown';
  return 'leave';
}

// T63 (review S1): after a timed plan runs out the bot stays this long (voice off) before leaving,
// so a late renewal does not mean inviting the bot again. Turned off / removed by an admin = leave now.
const EXPIRY_GRACE_MS = Math.max(0, Number(process.env.EXPIRY_GRACE_DAYS ?? 3) || 0) * 86_400_000;

/** End of the grace period (ms) when the guild's plan expired and the bot should still stay, else null. */
function graceUntil(guildId, now = Date.now()) {
  const f = subscriptionStore.getGuildFeatures(guildId);
  if (!f?.expired || f.active === false || !f.expires) return null;
  const end = Date.parse(f.expires) + EXPIRY_GRACE_MS;
  return Number.isFinite(end) && end > now ? end : null;
}

/** Whether Oud should leave a guild that is not currently allowed. */
function shouldLeaveGuild(guildId) {
  const action = unpaidGuildAction();
  if (action === 'stay') return false;
  if (graceUntil(guildId)) return false;
  if (action === 'leave-unknown') return !subscriptionStore.getGuildEntry(guildId);
  return true;
}

/** Per-guild bridge relay (subscriptions.json bridge:true). */
function isGuildBridgeRuntime(guildId) {
  if (!guildId) return false;
  const f = subscriptionStore.getGuildFeatures(guildId);
  return f.allowed && f.bridge;
}

/** Per-guild extra bots (subscriptions.json slaves:true). */
function isGuildSlavesRuntime(guildId) {
  if (!guildId) return false;
  return subscriptionStore.guildHasSlaves(guildId);
}

module.exports = {
  graceUntil,
  EXPIRY_GRACE_MS,
  isGuildBridgeRuntime,
  isGuildSlavesRuntime,
  shouldLeaveGuild,
  unpaidGuildAction,
};
