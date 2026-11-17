const path = require('path');
const { readJson } = require('../util/jsonFile');

const FILE = path.join(__dirname, '..', '..', 'data', 'slave-pool.json');

function readPool() {
  const res = readJson(FILE);
  if (!res.exists || !res.ok) return { bots: [] };
  const raw = res.data;
  if (!raw || !Array.isArray(raw.bots)) return { bots: [] };
  return raw;
}

function listPoolBots() {
  return readPool().bots
    .map(b => ({
      id: String(b.id),
      label: String(b.label || `بوت الغرفة ${b.id}`),
      clientId: b.clientId ? String(b.clientId) : null,
      inviteUrl: b.inviteUrl ? String(b.inviteUrl) : null,
      token: String(b.token || '').trim(),
    }))
    .filter(b => b.id && b.token);
}

function getPoolBot(id) {
  return listPoolBots().find(b => b.id === String(id)) || null;
}

function labelForToken(token) {
  const tok = String(token || '').trim();
  if (!tok) return null;
  return listPoolBots().find(b => b.token === tok)?.label ?? null;
}

module.exports = {
  FILE,
  listPoolBots,
  getPoolBot,
  labelForToken,
};
