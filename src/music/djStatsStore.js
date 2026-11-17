const { readStored, writeStored } = require('./musicStoragePath');

const KIND = 'djstats';

function read(queueKey) {
  const raw = readStored(KIND, queueKey, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function list(queueKey) {
  return read(queueKey);
}

function increment(queueKey, userId, by = 1) {
  const data = read(queueKey);
  data[userId] = (data[userId] || 0) + by;
  writeStored(KIND, queueKey, data);
  return data;
}

function clear(queueKey) {
  writeStored(KIND, queueKey, {});
  return {};
}

module.exports = { list, increment, clear };
