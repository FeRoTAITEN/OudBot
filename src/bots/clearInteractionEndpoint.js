// clearInteractionEndpoint.js – drop HTTP interaction handler before gateway login
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

function applicationIdFromToken(token) {
  const id = String(token || '').split('.')[0];
  return /^\d+$/.test(id) ? id : null;
}

async function clearInteractionEndpoint(token, tag) {
  const appId = applicationIdFromToken(token);
  if (!appId) return;

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    const app = await rest.get(Routes.application(appId));
    const url = app.interactions_endpoint_url;
    if (url) {
      console.warn(`${tag} Interactions Endpoint URL was set (pre-login): ${url}`);
      await rest.patch(Routes.application(appId), {
        body: { interactions_endpoint_url: null },
      });
      console.log(`${tag} Interactions Endpoint URL cleared (pre-login)`);
    }
  } catch (err) {
    console.warn(`${tag} Pre-login endpoint check: ${err.message}`);
  }
}

module.exports = { clearInteractionEndpoint, applicationIdFromToken };
