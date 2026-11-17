// applicationBootstrap.js – ensure interactions use gateway (not stale HTTP endpoint)

async function ensureGatewayInteractions(client, tag) {
  if (!client?.application) return;
  try {
    await client.application.fetch();
    const app = client.application;
    console.log(`${tag} Application ${app.id} (${app.name})`);
    const url = app.interactionsEndpointURL;
    if (url) {
      console.warn(`${tag} Interactions Endpoint URL was set: ${url}`);
      console.warn(`${tag} Clearing it — an HTTP handler was likely stealing button clicks`);
      await app.edit({ interactionsEndpointURL: null });
      console.log(`${tag} Interactions Endpoint URL cleared`);
    }
  } catch (err) {
    console.warn(`${tag} Application endpoint check: ${err.message}`);
  }
}

module.exports = { ensureGatewayInteractions };
