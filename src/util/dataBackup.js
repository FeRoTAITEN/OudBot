// dataBackup.js — daily snapshot of data/*.json + data/{history,playlists,djstats} into data/backups/<YYYY-MM-DD>/
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./jsonFile');

const BACKUP_DIRS = ['history', 'playlists', 'djstats'];
const DATE_NAME = /^\d{4}-\d{2}-\d{2}$/;

function parseKeepDays() {
  const n = parseInt(process.env.DATA_BACKUP_KEEP_DAYS || '14', 10);
  return Number.isFinite(n) ? n : 14;
}

function isJunkName(name) {
  return name === 'backups'
    || name === 'restore-pending.json'
    || name === 'restore-last.json'
    || name.includes('.restore-tmp')
    || name.endsWith('.bak')
    || name.includes('.tmp-')
    || name.includes('.corrupt-');
}

function pruneBackups(backupsRoot, keepDays) {
  if (!fs.existsSync(backupsRoot)) return;
  const dates = fs.readdirSync(backupsRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(n => DATE_NAME.test(n))
    .sort();
  const excess = dates.slice(0, dates.length - keepDays);
  for (const name of excess) {
    fs.rmSync(path.join(backupsRoot, name), { recursive: true, force: true });
  }
}

function runBackup(dataDir, tag = '[BACKUP]') {
  const keepDays = parseKeepDays();
  if (!keepDays || keepDays <= 0) return { dir: null, files: [] };

  try {
    const backupsRoot = path.join(dataDir, 'backups');
    const day = new Date().toISOString().slice(0, 10);
    const dest = path.join(backupsRoot, day);
    fs.mkdirSync(dest, { recursive: true });
    const files = [];

    for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (!name.endsWith('.json') || isJunkName(name)) continue;
      fs.copyFileSync(path.join(dataDir, name), path.join(dest, name));
      files.push(name);
    }

    for (const dir of BACKUP_DIRS) {
      const from = path.join(dataDir, dir);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, path.join(dest, dir), {
        recursive: true,
        filter: (p) => !isJunkName(path.basename(p)),
      });
      files.push(`${dir}/`);
    }

    pruneBackups(backupsRoot, keepDays);
    return { dir: dest, files };
  } catch (err) {
    console.warn(`${tag} data backup failed: ${err.message}`);
    return { dir: null, files: [] };
  }
}

function scheduleDataBackups(dataDir, tag = '[BACKUP]') {
  const keepDays = parseKeepDays();
  if (!keepDays || keepDays <= 0) {
    console.log(`${tag} data backups disabled (DATA_BACKUP_KEEP_DAYS=0)`);
    return;
  }
  runBackup(dataDir, tag);
  const t = setInterval(() => runBackup(dataDir, tag), 24 * 3600_000);
  t.unref();
}

// ---- T82: restore from the dashboard. The owner picks a day and files; the bot saves the choice in
// data/restore-pending.json and restarts (Wings restarts it). At boot, before any store reads its file,
// applyPendingRestore() snapshots the current files to backups/pre-restore-<ts>/ and copies the chosen ones back.
// Login / session / bot-token files are never restored from the dashboard.
const NO_RESTORE = /^(web-auth|web-sessions|web-oauth|bots|slave-pool|restore-pending)/i;
const PENDING = 'restore-pending.json';

function restorableIn(dataDir, date) {
  if (!DATE_NAME.test(String(date || ''))) return [];
  const dir = path.join(dataDir, 'backups', date);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.json') && !NO_RESTORE.test(e.name) && !isJunkName(e.name)) out.push(e.name);
    else if (e.isDirectory() && BACKUP_DIRS.includes(e.name)) out.push(`${e.name}/`);
  }
  return out.sort();
}

function requestRestore(dataDir, date, files, by = null) {
  const allowed = new Set(restorableIn(dataDir, date));
  const pick = [...new Set((Array.isArray(files) ? files : []).map(String))].filter(f => allowed.has(f));
  if (!pick.length) throw new Error('nothing to restore');
  writeJsonAtomic(path.join(dataDir, PENDING), { date, files: pick, by, at: new Date().toISOString() }, { backup: false });
  return pick;
}

function pendingRestore(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, PENDING), 'utf8')); } catch { return null; }
}

function cancelRestore(dataDir) {
  try { fs.rmSync(path.join(dataDir, PENDING), { force: true }); } catch { /* ignore */ }
}

function applyPendingRestore(dataDir, tag = '[RESTORE]') {
  const req = pendingRestore(dataDir);
  if (!req) return null;
  cancelRestore(dataDir); // one try only: a bad restore never loops
  const allowed = new Set(restorableIn(dataDir, req.date));
  const files = (req.files || []).filter(f => allowed.has(f));
  const src = path.join(dataDir, 'backups', req.date);
  const safety = path.join(dataDir, 'backups', `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const done = [];
  try {
    fs.mkdirSync(safety, { recursive: true });
    for (const f of files) {
      const name = f.replace(/\/$/, '');
      const cur = path.join(dataDir, name);
      if (fs.existsSync(cur)) fs.cpSync(cur, path.join(safety, name), { recursive: true });
    }
    for (const f of files) {
      const name = f.replace(/\/$/, '');
      const from = path.join(src, name);
      const to = path.join(dataDir, name);
      if (f.endsWith('/')) {
        const tmp = `${to}.restore-tmp`;
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.cpSync(from, tmp, { recursive: true });
        fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(tmp, to);
      } else {
        const tmp = `${to}.restore-tmp`;
        fs.copyFileSync(from, tmp);
        fs.renameSync(tmp, to);
      }
      done.push(f);
    }
    const old = fs.readdirSync(path.join(dataDir, 'backups')).filter(n => n.startsWith('pre-restore-')).sort();
    for (const n of old.slice(0, Math.max(0, old.length - 5))) fs.rmSync(path.join(dataDir, 'backups', n), { recursive: true, force: true });
    console.log(`${tag} restored ${done.length} item(s) from ${req.date}; previous copies in backups/${path.basename(safety)}`);
  } catch (err) {
    console.error(`${tag} restore failed after ${done.length} item(s): ${err.message}`);
  }
  try { writeJsonAtomic(path.join(dataDir, 'restore-last.json'), { ...req, done, safety: path.basename(safety), appliedAt: new Date().toISOString() }, { backup: false }); } catch { /* ignore */ }
  return { done, safety };
}

function lastRestore(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'restore-last.json'), 'utf8')); } catch { return null; }
}

module.exports = { runBackup, scheduleDataBackups, restorableIn, requestRestore, pendingRestore, cancelRestore, applyPendingRestore, lastRestore };
