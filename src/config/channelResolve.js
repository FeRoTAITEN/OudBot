function resolveTextChannelId(textEnv, voiceEnv) {
  const text = textEnv?.trim();
  const voice = voiceEnv?.trim();
  return text || voice || null;
}

/** Panel text override, else voice-room chat when voice was moved in panel, else .env fallback. */
function resolveTextForBot(stored, voiceChannelId, envTextFallback) {
  if (stored?.textChannelId?.trim()) return stored.textChannelId.trim();
  if (stored?.voiceChannelId?.trim()) return voiceChannelId;
  const fb = envTextFallback?.trim();
  return fb || voiceChannelId || null;
}

module.exports = { resolveTextChannelId, resolveTextForBot };
