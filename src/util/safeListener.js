const { t } = require('../i18n/context');
const { Ephemeral } = require('./interactionFlags');

// safeListener(tag, fn) -> async (...args) => { ... }
// Runs fn(...args); on throw/rejection:
//  - ignore DiscordAPIError codes 10062 (Unknown interaction) and 40060 (already acknowledged):
//    log one console.warn line `${tag} interaction expired (<code>)`
//  - otherwise console.error(`${tag} handler error:`, err?.stack || err?.message || err)
//  - if args[0] looks like an interaction (typeof args[0]?.isRepliable === 'function' && args[0].isRepliable()):
//      content = t('err.unexpected')
//      if (!i.deferred && !i.replied) await i.reply({ content, flags: Ephemeral })
//      else await i.followUp({ content, flags: Ephemeral })
//      wrap that answer in its own try/catch and ignore failures
//  Never rethrow.
function safeListener(tag, fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err && (err.code === 10062 || err.code === 40060)) {
        console.warn(`${tag} interaction expired (${err.code})`);
        return;
      }
      // T70 (review U6): a short reference the user can send us, and the same reference in the log.
      const ref = `E-${Date.now().toString(36).slice(-5).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
      console.error(`${tag} handler error [${ref}]:`, err?.stack || err?.message || err);
      const i = args[0];
      if (typeof i?.isRepliable === 'function' && i.isRepliable()) {
        const localeStore = require('../i18n/localeStore');
        const { runWithLocale } = require('../i18n/context');
        const lang = (() => { try { return localeStore.resolveFromInteraction(i); } catch { return null; } })();
        try {
          await runWithLocale(lang, async () => {
            const contact = process.env.DEFAULT_CONTACT_URL?.trim();
            const help = contact ? `\n${t('err.unexpectedContact', { url: contact })}` : '';
            const content = `${t('err.unexpected', { ref })}${help}`;
            if (!i.deferred && !i.replied) await i.reply({ content, flags: Ephemeral });
            else await i.followUp({ content, flags: Ephemeral });
          });
        } catch { /* ignore failures answering the interaction */ }
      }
    }
  };
}

module.exports = { safeListener };
