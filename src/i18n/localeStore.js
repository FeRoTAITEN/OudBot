const { DEFAULT_LOCALE, detectLangFromCommand, resolveLang } = require('./index');

const byUser = new Map();

function get(userId) {
  return byUser.get(String(userId)) || DEFAULT_LOCALE;
}

function set(userId, lang) {
  byUser.set(String(userId), resolveLang(lang));
}

function resolveFromMessage(message) {
  const detected = detectLangFromCommand(message.content);
  const userId = message.author?.id;
  if (detected && userId) set(userId, detected);
  return userId ? get(userId) : (detected || DEFAULT_LOCALE);
}

function resolveFromInteraction(interaction) {
  const userId = interaction.user?.id;
  return userId ? get(userId) : DEFAULT_LOCALE;
}

module.exports = {
  get,
  set,
  resolveFromMessage,
  resolveFromInteraction,
};
