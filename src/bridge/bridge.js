// bridge.js - Internal audio bridge between SLAVE and MASTER
const { EventEmitter } = require('events');
const registry = require('./registry');
const { isOpusComfortNoise } = require('./opusFrames');
const { resolveSlaveRoom } = require('./sourceKey');

const bridge = new EventEmitter();
bridge.setMaxListeners(100);

let legacyRelay = null;
const guildRelays = new Map();

function resolveGuildIdForSource(source) {
  const parts = String(source).split(':');
  if (parts.length >= 3 && /^\d{17,20}$/.test(parts[0])) return parts[0];
  const room = resolveSlaveRoom(source);
  for (const [, entry] of registry.state.slaves) {
    if (String(entry.name) === room && entry.cfg?.guildId) {
      return String(entry.cfg.guildId);
    }
  }
  return null;
}

function relayForSource(source) {
  const guildId = resolveGuildIdForSource(source);
  if (guildId && guildRelays.has(guildId)) return guildRelays.get(guildId);
  return legacyRelay;
}

bridge.on('audio', (frame, source) => {
  if (!frame?.length) return;
  if (registry.isBridgeMuted(source)) return;
  const relay = relayForSource(source);
  // Comfort-noise = word-gap markers — extend speech window, don't play them.
  if (isOpusComfortNoise(frame)) {
    relay?.addFrame(frame, source);
    return;
  }
  registry.recordFrame(registry.roomKeyFromSource(source));
  relay?.addFrame(frame, source);
});

bridge.setRelay = (relay) => {
  legacyRelay = relay;
};

bridge.setGuildRelay = (guildId, relay) => {
  const id = String(guildId);
  if (relay) guildRelays.set(id, relay);
  else guildRelays.delete(id);
};

bridge.getGuildRelay = (guildId) => guildRelays.get(String(guildId)) ?? null;

bridge.listGuildRelays = () => [...guildRelays.entries()];

module.exports = bridge;
