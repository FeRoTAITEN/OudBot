const fs = require('fs');
const path = require('path');

let tmpCounter = 0;
const corruptSeen = new Set();

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function statOrNull(fp) {
  try {
    return fs.statSync(fp);
  } catch {
    return null;
  }
}

/**
 * @returns {{ ok: boolean, exists: boolean, data: *, fromBackup?: boolean, error?: string }}
 */
function readJson(fp) {
  const st = statOrNull(fp);
  if (!st) return { ok: true, exists: false, data: null };

  let text;
  try {
    text = fs.readFileSync(fp, 'utf8');
  } catch (err) {
    return { ok: false, exists: true, data: null, error: err.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const key = `${fp}|${st.mtimeMs}|${st.mtimeMsNs}`;
    const name = path.basename(fp);
    if (!corruptSeen.has(key)) {
      corruptSeen.add(key);
      console.error(`[JSON] Corrupt ${name}: ${err.message} — keeping previous data`);
      try {
        fs.copyFileSync(fp, `${fp}.corrupt-${stamp()}`);
      } catch { /* keep going — backup of the bad file is best-effort */ }
    }
    const bak = `${fp}.bak`;
    const bakSt = statOrNull(bak);
    if (bakSt) {
      try {
        const bakData = JSON.parse(fs.readFileSync(bak, 'utf8'));
        console.warn(`[JSON] Restored ${name} from .bak`);
        return { ok: true, exists: true, data: bakData, fromBackup: true };
      } catch { /* fall through */ }
    }
    return { ok: false, exists: true, data: null, error: err.message };
  }
  return { ok: true, exists: true, data: parsed };
}

// True when fp exists on disk but cannot be parsed (and no valid .bak). Does not log (readJson already did).
function isUnreadable(fp) {
  const st = statOrNull(fp);
  if (!st) return false;
  let text;
  try {
    text = fs.readFileSync(fp, 'utf8');
  } catch {
    return true;
  }
  try {
    JSON.parse(text);
    return false;
  } catch {
    const bak = `${fp}.bak`;
    try {
      JSON.parse(fs.readFileSync(bak, 'utf8'));
      return false;
    } catch { /* .bak missing or also invalid */ }
    return true;
  }
}

/**
 * Write JSON atomically (tmp + fsync + rename), keeping a .bak of the
 * previous *valid* content. Throws on failure.
 */
function writeJsonAtomic(fp, data, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const text = JSON.stringify(data, null, 2);
  if (backup) {
    try {
      const st = fs.statSync(fp);
      if (st.isFile()) {
        JSON.parse(fs.readFileSync(fp, 'utf8')); // only back up if current content is valid JSON
        fs.copyFileSync(fp, `${fp}.bak`);
      }
    } catch { /* missing or unparsable — nothing to preserve */ }
  }
  tmpCounter += 1;
  const tmp = `${fp}.tmp-${process.pid}-${tmpCounter}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, text, 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, fp);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw err;
  }
}

/**
 * Watch a JSON file via its parent directory (survives rename-based saves).
 * Only exact basename matches trigger onChange; .tmp-/.bak/.corrupt- files
 * never match. Returns { close() }.
 */
function watchJson(fp, onChange, { debounceMs = 500 } = {}) {
  const dir = path.dirname(fp);
  const name = path.basename(fp);
  let watcher = null;
  let timer = null;
  const close = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      try { watcher.close(); } catch { /* already closed */ }
      watcher = null;
    }
  };
  const onEvent = (event, filename) => {
    if (filename != null && filename !== name) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        onChange();
      } catch (err) {
        console.warn(`[JSON] watch handler ${name}: ${err.message}`);
      }
    }, debounceMs);
  };
  try {
    watcher = fs.watch(dir, { persistent: false }, onEvent);
  } catch {
    try {
      fs.mkdirSync(dir, { recursive: true });
      watcher = fs.watch(dir, { persistent: false }, onEvent);
    } catch (err) {
      console.warn(`[JSON] watch ${name}: ${err.message} — watcher disabled`);
      return { close };
    }
  }
  return { close };
}

module.exports = { readJson, writeJsonAtomic, watchJson, isUnreadable };
