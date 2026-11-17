// sourceKey.js – per-user bridge source ids (room:userId)

function makeUserSourceKey(slaveName, userId, guildId = null) {
  if (guildId) return `${String(guildId)}:${String(slaveName)}:${String(userId)}`;
  return `${String(slaveName)}:${String(userId)}`;
}

/** Room-level key for panel mute/volume/solo (e.g. "1" from "1:123456"). */
function resolveSlaveRoom(source) {
  const parts = String(source).split(':');
  if (parts.length >= 3 && /^\d{17,20}$/.test(parts[0])) return parts[1];
  if (parts.length >= 2) return parts[0];
  return String(source);
}

function isUserSourceKey(source) {
  return String(source).includes(':');
}

function parseUserSourceKey(source) {
  const parts = String(source).split(':');
  if (parts.length >= 3 && /^\d{17,20}$/.test(parts[0])) {
    return { guildId: parts[0], slaveName: parts[1], userId: parts[2] };
  }
  if (parts.length === 2) {
    return { slaveName: parts[0], userId: parts[1] };
  }
  return null;
}

module.exports = {
  makeUserSourceKey,
  resolveSlaveRoom,
  isUserSourceKey,
  parseUserSourceKey,
};
