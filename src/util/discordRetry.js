const { isRecoverableNetworkError } = require('./networkError');

const DEFAULT_ATTEMPTS = Math.max(
  2,
  parseInt(process.env.DISCORD_UI_RETRY_ATTEMPTS || '3', 10) || 3,
);
const DEFAULT_DELAY_MS = Math.max(
  250,
  parseInt(process.env.DISCORD_UI_RETRY_DELAY_MS || '750', 10) || 750,
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDiscordError(err) {
  if (!err) return false;
  if (isRecoverableNetworkError(err)) return true;
  const code = err.code ?? err.status ?? err.httpStatus;
  if (code === 500 || code === 502 || code === 503 || code === 504) return true;
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return true;
  // Interaction already acknowledged — do not retry.
  if (code === 10062 || code === 40060 || code === 10008) return false;
  return false;
}

async function withDiscordRetry(fn, { attempts = DEFAULT_ATTEMPTS, delayMs = DEFAULT_DELAY_MS } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableDiscordError(err) || i >= attempts - 1) throw err;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

async function discordMessageEdit(message, payload, opts) {
  if (!message) return null;
  return withDiscordRetry(() => message.edit(payload), opts);
}

async function discordMessageSend(channel, payload, opts) {
  if (!channel) return null;
  return withDiscordRetry(() => channel.send(payload), opts);
}

async function discordInteractionUpdate(interaction, payload, opts) {
  return withDiscordRetry(() => interaction.update(payload), opts);
}

async function discordInteractionEditReply(interaction, payload, opts) {
  return withDiscordRetry(() => interaction.editReply(payload), opts);
}

async function discordInteractionReply(interaction, payload, opts) {
  return withDiscordRetry(() => interaction.reply(payload), opts);
}

async function discordInteractionFollowUp(interaction, payload, opts) {
  return withDiscordRetry(() => interaction.followUp(payload), opts);
}

module.exports = {
  withDiscordRetry,
  discordMessageEdit,
  discordMessageSend,
  discordInteractionUpdate,
  discordInteractionEditReply,
  discordInteractionReply,
  discordInteractionFollowUp,
  isRetryableDiscordError,
  DEFAULT_ATTEMPTS,
  DEFAULT_DELAY_MS,
};
