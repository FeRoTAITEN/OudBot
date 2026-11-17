const { AsyncLocalStorage } = require('async_hooks');
const { createTranslator, resolveLang, DEFAULT_LOCALE } = require('./index');

const als = new AsyncLocalStorage();
let defaultLang = DEFAULT_LOCALE;
let defaultT = createTranslator(DEFAULT_LOCALE);
const translators = new Map();

function translatorFor(lang) {
  let fn = translators.get(lang);
  if (!fn) { fn = createTranslator(lang); translators.set(lang, fn); }
  return fn;
}

function t(key, vars) {
  const store = als.getStore();
  return (store ? store.t : defaultT)(key, vars);
}

function getLang() {
  return als.getStore()?.lang ?? defaultLang;
}

// Inside a runWithLocale scope: changes that scope only. Outside: changes the default.
function setLocale(lang) {
  const resolved = resolveLang(lang);
  const store = als.getStore();
  if (store) { store.lang = resolved; store.t = translatorFor(resolved); return; }
  defaultLang = resolved;
  defaultT = translatorFor(resolved);
}

async function runWithLocale(lang, fn) {
  const resolved = resolveLang(lang);
  return als.run({ lang: resolved, t: translatorFor(resolved) }, () => fn());
}

module.exports = { t, getLang, setLocale, runWithLocale };
