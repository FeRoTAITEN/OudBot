// messageDedup.js – ignore duplicate messageCreate deliveries (double listeners / processes)
const recent = new Map();
const TTL_MS = 30_000;

function claimMessage(key) {
  const now = Date.now();
  if (recent.has(key)) return false;
  recent.set(key, now);
  setTimeout(() => recent.delete(key), TTL_MS);
  return true;
}

function messageKey(botUserId, message) {
  return `${botUserId}:${message.id}`;
}

/** One music command per message per bot (master + slaves can each handle their room). */
function claimMusicMessage(botUserId, messageId) {
  const bot = botUserId ? String(botUserId) : 'unknown';
  return claimMessage(`music:${bot}:${messageId}`);
}

/** One handler per bot per music interaction */
function claimMusicInteraction(botUserId, interactionId) {
  const bot = botUserId ? String(botUserId) : 'unknown';
  return claimMessage(`music:i:${bot}:${interactionId}`);
}

/** One music reply per message across all bots (shared text rooms). */
function claimMusicReply(messageId) {
  return claimMessage(`music:reply:${messageId}`);
}

/** One music reply per interaction across all bots. */
function claimMusicReplyInteraction(interactionId) {
  return claimMessage(`music:reply:i:${interactionId}`);
}

/** @deprecated use claimMusicReply */
function claimMusicDenyMessage(messageId) {
  return claimMusicReply(messageId);
}

/** @deprecated use claimMusicReplyInteraction */
function claimMusicDenyInteraction(interactionId) {
  return claimMusicReplyInteraction(interactionId);
}

module.exports = {
  claimMessage,
  messageKey,
  claimMusicMessage,
  claimMusicInteraction,
  claimMusicReply,
  claimMusicReplyInteraction,
  claimMusicDenyMessage,
  claimMusicDenyInteraction,
};
