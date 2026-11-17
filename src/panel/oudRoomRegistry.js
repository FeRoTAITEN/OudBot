/** Rooms where @everyone may be hidden — bot-created or named Oud Center only. */
const selfCreatedRoomIds = new Set();

function oudCenterName() {
  return process.env.MASTER_ROOM_NAME?.trim() || 'Voice Bridge';
}

function markBotCreatedRoom(channelId) {
  if (channelId) selfCreatedRoomIds.add(String(channelId));
}

function isBotCreatedRoom(channelId) {
  return channelId ? selfCreatedRoomIds.has(String(channelId)) : false;
}

function isOudManagedRoom(channel) {
  if (!channel) return false;
  if (isBotCreatedRoom(channel.id)) return true;
  return channel.name === oudCenterName();
}

module.exports = {
  oudCenterName,
  markBotCreatedRoom,
  isBotCreatedRoom,
  isOudManagedRoom,
};
