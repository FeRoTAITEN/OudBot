const en = require('./locales/en');
const ar = require('./locales/ar');

const LOCALES = { en, ar };
const DEFAULT_LOCALE = 'en';

const SUBS_COMMANDS = {
  en: ['subs'],
  ar: ['اشتراكات', 'اشتراك'],
};

const PANEL_COMMANDS = {
  en: ['panel'],
  ar: ['لوحة', 'لوحه'],
};

const HELP_COMMANDS = {
  en: ['help'],
  ar: ['مساعدة'],
};

const PLAY_COMMANDS = {
  en: 'p',
  ar: 'ش',
};

const PLAY_ALIASES = {
  en: ['play', 'p'],
  ar: ['شغل', 'ش'],
};

const PLAY_PREFIXES = [...PLAY_ALIASES.en, ...PLAY_ALIASES.ar]
  .sort((a, b) => b.length - a.length);

const MUSIC_CTL_COMMANDS = {
  skip: { en: ['skip'], ar: ['تخطي'] },
  stop: { en: ['stop'], ar: ['وقف', 'ايقاف'] },
  loop: { en: ['loop'], ar: ['تكرار'] },
  vol: { en: ['vol', 'volume'], ar: ['صوت'] },
  history: { en: ['history'], ar: ['سجل'] },
  auto: { en: ['auto', 'autodj'], ar: ['تلقائي'] },
  lyrics: { en: ['lyrics'], ar: ['كلمات'] },
  // T62 (review M5): actions that were buttons only.
  pause: { en: ['pause'], ar: ['مؤقت'] },
  resume: { en: ['resume'], ar: ['كمل', 'استئناف'] },
  np: { en: ['np', 'nowplaying'], ar: ['الحالية'] },
  queue: { en: ['queue', 'q'], ar: ['القائمة', 'الطابور'] },
  shuffle: { en: ['shuffle'], ar: ['خلط'] },
  remove: { en: ['remove', 'rm'], ar: ['احذف'] },
  clear: { en: ['clear'], ar: [] },
  seek: { en: ['seek'], ar: ['قدم'] },
  back: { en: ['back'], ar: ['رجع'] },
};
// "وقف مؤقت" / "ايقاف مؤقت" = pause (the first word alone is stop).
const PAUSE_PHRASES = new Set(['وقف مؤقت', 'ايقاف مؤقت', 'إيقاف مؤقت']);
// Clearing the queue is never one common word: "امسح" alone is chat.
const CLEAR_PHRASES = new Set(['امسح القائمة', 'امسح الطابور']);

function normalizeCommand(text) {
  return String(text).trim().toLowerCase();
}

function isPlayAlias(text, lang) {
  const cmd = normalizeCommand(text);
  const trimmed = String(text).trim();
  if (lang === 'ar') return PLAY_ALIASES.ar.includes(trimmed) || PLAY_ALIASES.ar.includes(cmd);
  return PLAY_ALIASES.en.includes(cmd);
}

function isBarePlayCommand(text) {
  return isPlayAlias(text, 'en') || isPlayAlias(text, 'ar');
}

// Short prefixes ("ش", "p") collide with chat ("ش رايكم نطلع"); they only count as play
// when the rest looks like a song request, not a sentence.
const SHORT_PLAY_PREFIXES = new Set(['ش', 'p']);
const SHORT_PLAY_MAX_WORDS = 8;
const CHAT_LEAD_WORDS = new Set([
  'رايكم', 'رايك', 'رأيكم', 'رأيك', 'وش', 'ايش', 'إيش', 'شو', 'تبون', 'تبي', 'تبين', 'فيه', 'في',
  'صار', 'صاير', 'السالفة', 'سالفة', 'قصدك', 'قصدي', 'يعني', 'معنى', 'اللي', 'الي', 'هذا', 'هذي',
  'عندكم', 'عندك', 'متى', 'ليش', 'كيف', 'وين', 'مين', 'كم', 'هل', 'نطلع', 'نسوي', 'اسوي', 'تسوي',
]);

function looksLikeShortPlayQuery(query) {
  if (/^https?:\/\//i.test(query)) return true;
  if (/[?؟]/.test(query)) return false;
  const words = query.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > SHORT_PLAY_MAX_WORDS) return false;
  return !CHAT_LEAD_WORDS.has(words[0]);
}

function extractPlayQuery(text) {
  const trimmed = String(text).trim();
  for (const prefix of PLAY_PREFIXES) {
    const lead = `${prefix} `;
    const lowerLead = `${prefix.toLowerCase()} `;
    if (trimmed.length <= lead.length) continue;
    if (trimmed.toLowerCase().startsWith(lowerLead) || trimmed.startsWith(lead)) {
      const query = trimmed.slice(prefix.length + 1).trim();
      if (SHORT_PLAY_PREFIXES.has(prefix.toLowerCase()) && !looksLikeShortPlayQuery(query)) return null;
      return query;
    }
  }
  return null;
}

function isPlayMessage(text) {
  return isBarePlayCommand(text) || extractPlayQuery(text) != null;
}

function detectPlayLang(text) {
  const trimmed = String(text).trim();
  const cmd = normalizeCommand(text);
  if (isPlayAlias(text, 'ar')) return 'ar';
  if (isPlayAlias(text, 'en')) return 'en';
  for (const prefix of PLAY_ALIASES.ar) {
    if (trimmed.startsWith(`${prefix} `)) return 'ar';
  }
  for (const prefix of PLAY_ALIASES.en) {
    if (trimmed.toLowerCase().startsWith(`${prefix.toLowerCase()} `)) return 'en';
  }
  if (cmd === PLAY_COMMANDS.ar) return 'ar';
  if (cmd === PLAY_COMMANDS.en) return 'en';
  return null;
}

// A control word only counts as a command when the message is the command alone,
// or the command plus an argument it accepts ("صوت 80"); "وقف شوي يا شباب" is chat.
const AUTO_MAX_ARG_WORDS = 3;

const SEEK_ARG = /^(\d{1,4}|\d{1,3}:\d{2})$/;

function ctlArgAccepted(action, arg) {
  if (!arg) return !['remove', 'seek', 'back'].includes(action);
  if (action === 'vol') return /^\d{1,3}\s*%?$/.test(arg);
  if (action === 'remove') return /^\d{1,4}$/.test(arg);
  if (action === 'seek' || action === 'back') return SEEK_ARG.test(arg);
  if (action === 'auto') return !/[?؟]/.test(arg) && arg.split(/\s+/).length <= AUTO_MAX_ARG_WORDS;
  return false;
}

function parseMusicCtlCommand(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (PAUSE_PHRASES.has(parts.join(' '))) return { action: 'pause', arg: null, lang: 'ar' };
  if (CLEAR_PHRASES.has(parts.join(' '))) return { action: 'clear', arg: null, lang: 'ar' };
  const firstWord = parts[0];
  const firstNorm = firstWord.toLowerCase();
  const arg = parts.slice(1).join(' ').trim() || null;

  for (const [action, aliases] of Object.entries(MUSIC_CTL_COMMANDS)) {
    const arMatch = aliases.ar.includes(firstWord);
    const enMatch = aliases.en.some(a => a.toLowerCase() === firstNorm);
    if (arMatch || enMatch) {
      if (!ctlArgAccepted(action, arg)) return null;
      return { action, arg, lang: arMatch ? 'ar' : 'en' };
    }
  }
  return null;
}

function detectCtlLang(text) {
  const parsed = parseMusicCtlCommand(text);
  return parsed?.lang ?? null;
}

function detectLangFromCommand(text) {
  const cmd = normalizeCommand(text);
  for (const [lang, cmds] of Object.entries(PANEL_COMMANDS)) {
    if (cmds.includes(cmd)) return lang;
  }
  for (const [lang, cmds] of Object.entries(HELP_COMMANDS)) {
    if (cmds.includes(cmd)) return lang;
  }
  const playLang = detectPlayLang(text);
  if (playLang) return playLang;
  const ctlLang = detectCtlLang(text);
  if (ctlLang) return ctlLang;
  return null;
}

function isSubsCommand(text) {
  const cmd = normalizeCommand(text);
  const first = cmd.split(/\s+/)[0];
  return SUBS_COMMANDS.en.includes(first) || SUBS_COMMANDS.ar.includes(first);
}

function detectSubsLang(text) {
  const first = normalizeCommand(text).split(/\s+/)[0];
  for (const [lang, cmds] of Object.entries(SUBS_COMMANDS)) {
    if (cmds.includes(first)) return lang;
  }
  return null;
}

function isPanelCommand(text) {
  const cmd = normalizeCommand(text);
  return PANEL_COMMANDS.en.includes(cmd) || PANEL_COMMANDS.ar.includes(cmd);
}

function isHelpCommand(text) {
  const cmd = normalizeCommand(text);
  return HELP_COMMANDS.en.includes(cmd) || HELP_COMMANDS.ar.includes(cmd);
}

function createTranslator(lang) {
  const strings = LOCALES[lang] || LOCALES[DEFAULT_LOCALE];
  const fallback = LOCALES[DEFAULT_LOCALE];
  return function t(key, vars = {}) {
    let str = strings[key] ?? fallback[key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return str;
  };
}

function resolveLang(lang) {
  return LOCALES[lang] ? lang : DEFAULT_LOCALE;
}

function playCommand(lang) {
  return lang === 'ar' ? PLAY_COMMANDS.ar : PLAY_COMMANDS.en;
}

module.exports = {
  DEFAULT_LOCALE,
  PANEL_COMMANDS,
  HELP_COMMANDS,
  PLAY_COMMANDS,
  PLAY_ALIASES,
  MUSIC_CTL_COMMANDS,
  SUBS_COMMANDS,
  detectLangFromCommand,
  isSubsCommand,
  detectSubsLang,
  isPanelCommand,
  isHelpCommand,
  isBarePlayCommand,
  extractPlayQuery,
  isPlayMessage,
  parseMusicCtlCommand,
  playCommand,
  createTranslator,
  resolveLang,
};
