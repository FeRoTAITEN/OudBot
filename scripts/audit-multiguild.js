/**
 * Quick multi-guild sanity checks (no Discord connection).
 * Run: node scripts/audit-multiguild.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const subscriptionStore = require('../src/subscription/subscriptionStore');
const { queueKeyForGuild } = require('../src/music/queueKey');
const { filePath, guildIdForQueueKey } = require('../src/music/musicStoragePath');
const historyStore = require('../src/music/historyStore');
const playlistStore = require('../src/music/playlistStore');
const guildChannelsStore = require('../src/panel/guildChannelsStore');
const { parseMusicId } = require('../src/music/musicUI');
const { musicQueueKeyMatches } = require('../src/music/queueKey');

let failed = 0;

function ok(label) {
  console.log(`  OK ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`  FAIL ${label}: ${detail}`);
}

console.log('[audit] Multi-guild checks\n');

subscriptionStore.reload();
const guildIds = subscriptionStore.listGuildIds();
console.log(`Subscribed guilds: ${guildIds.length}`);

for (const id of guildIds) {
  const key = queueKeyForGuild(id);
  const histPath = filePath('history', key);
  const plPath = filePath('playlists', key);
  if (guildIdForQueueKey(key) !== id) {
    fail(`queueKey ${key}`, 'guildId mismatch');
  } else {
    ok(`queueKey ${key} → guild ${id}`);
  }
  if (!histPath.includes(path.join('guilds', id))) {
    fail('history path', histPath);
  } else {
    ok(`history path for ${id}`);
  }
  if (!plPath.includes(path.join('guilds', id))) {
    fail('playlist path', plPath);
  } else {
    ok(`playlist path for ${id}`);
  }
  historyStore.list(key);
  playlistStore.list(key);
  guildChannelsStore.ensureGuildEntry(id);
}

const sampleId = guildIds[0] || '766294211233841204';
const sampleKey = queueKeyForGuild(sampleId);
const cid = `music:guild:${sampleId}:history`;
const parsed = parseMusicId(cid);
if (!parsed || parsed.queueKey !== sampleKey) {
  fail('parseMusicId', JSON.stringify(parsed));
} else {
  ok(`parseMusicId ${cid}`);
}

if (!musicQueueKeyMatches(sampleKey, sampleKey, sampleId)) {
  fail('musicQueueKeyMatches', 'same key');
} else {
  ok('musicQueueKeyMatches same guild');
}

if (musicQueueKeyMatches('master', sampleKey, sampleId)) {
  ok('legacy master key accepted for global guild');
} else {
  fail('legacy master key', 'not matched');
}

const otherId = guildIds.find(g => g !== sampleId);
if (otherId && musicQueueKeyMatches(sampleKey, queueKeyForGuild(otherId), otherId)) {
  fail('cross-guild key isolation', 'keys matched across guilds');
} else if (otherId) {
  ok('cross-guild queue keys isolated');
}

console.log('');
if (failed) {
  console.error(`[audit] ${failed} check(s) failed`);
  process.exit(1);
}
console.log('[audit] All checks passed');
