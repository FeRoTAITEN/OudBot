const fs = require('fs');
const path = require('path');
const { readJson: readJsonFile, writeJsonAtomic } = require('../util/jsonFile');
const { guildIdFromQueueKey } = require('./queueKey');
const { parseSlaveQueueKey } = require('./slaveQueueKey');
const { resolveGuildId } = require('../config/channels');

const DATA_ROOT = path.join(__dirname, '..', '..', 'data');
const migratedKinds = new Set();

function resolveRoomTarget(queueKey) {
  const key = String(queueKey);
  const fromGuild = guildIdFromQueueKey(key);
  if (fromGuild) {
    return { guildId: fromGuild, room: 'master' };
  }

  const slave = parseSlaveQueueKey(key);
  if (slave) {
    const guildId = slave.guildId || resolveGuildId();
    if (guildId) {
      return { guildId, room: `slave-${slave.name}` };
    }
    return { guildId: null, room: key };
  }

  if (key === 'master') {
    const guildId = resolveGuildId();
    if (guildId) return { guildId, room: 'master' };
    return { guildId: null, room: 'master' };
  }

  if (key.startsWith('slave-')) {
    const guildId = resolveGuildId();
    if (guildId) return { guildId, room: key };
    return { guildId: null, room: key };
  }

  return { guildId: null, room: key.replace(/[^a-z0-9-_]/gi, '_') };
}

function legacyFlatName(queueKey) {
  return String(queueKey).replace(/[^a-z0-9-_]/gi, '_');
}

function filePath(kind, queueKey) {
  const target = resolveRoomTarget(queueKey);
  if (target.guildId) {
    return path.join(DATA_ROOT, kind, 'guilds', target.guildId, `${target.room}.json`);
  }
  return path.join(DATA_ROOT, kind, `${legacyFlatName(queueKey)}.json`);
}

function legacyCandidates(kind, queueKey) {
  const candidates = [];
  const flatDir = path.join(DATA_ROOT, kind);
  const target = resolveRoomTarget(queueKey);

  if (target.guildId) {
    candidates.push(path.join(flatDir, `guild_${target.guildId}.json`));
    const envGuild = resolveGuildId();
    const isOriginalGuild = envGuild && String(envGuild) === String(target.guildId);
    if (isOriginalGuild) {
      if (target.room === 'master') {
        candidates.push(path.join(flatDir, 'master.json'));
      } else {
        const slaveNum = target.room.match(/^slave-(\d+)$/);
        if (slaveNum) candidates.push(path.join(flatDir, `slave-${slaveNum[1]}.json`));
        candidates.push(path.join(flatDir, `${target.room}.json`));
      }
    }
  } else {
    candidates.push(path.join(flatDir, `${legacyFlatName(queueKey)}.json`));
  }

  return candidates;
}

function readJson(fp, fallback) {
  const res = readJsonFile(fp);
  if (!res.exists || !res.ok) return fallback;
  return res.data;
}

function migrateFlatFiles(kind) {
  if (migratedKinds.has(kind)) return;
  migratedKinds.add(kind);

  const flatDir = path.join(DATA_ROOT, kind);
  if (!fs.existsSync(flatDir)) return;

  const guildId = resolveGuildId();
  const entries = fs.readdirSync(flatDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const name = entry.name.slice(0, -5);
    const src = path.join(flatDir, entry.name);

    let dest;
    const guildFlat = name.match(/^guild_(\d+)$/);
    if (guildFlat) {
      dest = path.join(flatDir, 'guilds', guildFlat[1], 'master.json');
    } else if (name === 'master' && guildId) {
      dest = path.join(flatDir, 'guilds', guildId, 'master.json');
    } else if (name.startsWith('slave-') && guildId) {
      dest = path.join(flatDir, 'guilds', guildId, `${name}.json`);
    } else {
      continue;
    }

    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    try { fs.unlinkSync(src); } catch { /* keep source if delete fails */ }
    console.log(`[MUSIC] Migrated ${kind}/${entry.name} → ${path.relative(DATA_ROOT, dest)}`);
  }
}

function readStored(kind, queueKey, fallback) {
  migrateFlatFiles(kind);
  const fp = filePath(kind, queueKey);
  let data = readJson(fp, null);
  if (data != null) return data;

  for (const legacy of legacyCandidates(kind, queueKey)) {
    if (!fs.existsSync(legacy)) continue;
    data = readJson(legacy, fallback);
    writeStored(kind, queueKey, data);
    return data;
  }
  return fallback;
}

function writeStored(kind, queueKey, data) {
  const fp = filePath(kind, queueKey);
  writeJsonAtomic(fp, data);
}

function guildIdForQueueKey(queueKey) {
  return resolveRoomTarget(queueKey).guildId;
}

module.exports = {
  filePath,
  readStored,
  writeStored,
  guildIdForQueueKey,
  resolveRoomTarget,
};
