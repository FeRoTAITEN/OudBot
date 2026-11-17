// listenHub.js – taps the Opus packets our bots send to Discord (VoiceConnection.prepareAudioPacket).
// Subscribers (webMix) get (connection, packet). Without listeners webMix returns at once.
const patched = new WeakSet();
const subs = [];

function attach(connection) {
  if (!connection || patched.has(connection) || typeof connection.prepareAudioPacket !== 'function') return;
  patched.add(connection);
  const orig = connection.prepareAudioPacket.bind(connection);
  connection.prepareAudioPacket = (buf) => {
    for (const fn of subs) {
      try { fn(connection, buf); } catch { /* never break voice */ }
    }
    return orig(buf);
  };
}

function onPacket(fn) {
  subs.push(fn);
}

module.exports = { attach, onPacket };
