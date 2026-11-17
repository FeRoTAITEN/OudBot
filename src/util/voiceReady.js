// voiceReady.js – promise that resolves after first successful voice join
function attachVoiceReady(client) {
  let resolveReady;
  client.whenVoiceReady = new Promise((resolve) => {
    resolveReady = resolve;
  });
  client.markVoiceReady = () => {
    if (resolveReady) {
      resolveReady();
      resolveReady = null;
    }
  };
  return client;
}

module.exports = { attachVoiceReady };
