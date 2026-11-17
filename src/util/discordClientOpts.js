function discordRestOptions() {
  const timeout = Math.max(
    10_000,
    parseInt(process.env.DISCORD_REST_TIMEOUT_MS || '30000', 10) || 30_000,
  );
  const retries = Math.max(
    1,
    parseInt(process.env.DISCORD_REST_RETRIES || '3', 10) || 3,
  );
  return { rest: { timeout, retries } };
}

module.exports = { discordRestOptions };
