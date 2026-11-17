const registry = require('../bridge/registry');
const { getMasterChannels } = require('../config/channels');
const { t } = require('../i18n/context');

async function notifyGuildOwnerBotInvite(guildId, { poolBot, slotName }) {
  const master = registry.state.master?.client;
  if (!master) return { ok: false, reason: 'no_master' };

  const guild = master.guilds.cache.get(String(guildId))
    ?? await master.guilds.fetch(String(guildId)).catch(() => null);
  if (!guild) return { ok: false, reason: 'guild_not_found' };

  const inviteUrl = poolBot?.inviteUrl || '';
  const text = t('subs.ownerBotNotify', {
    guild: guild.name,
    bot: poolBot?.label || slotName,
    slot: slotName,
    url: inviteUrl || '—',
  });

  let ownerUser = null;
  if (guild.ownerId) {
    ownerUser = await master.users.fetch(guild.ownerId).catch(() => null);
  }
  if (!ownerUser) {
    try {
      ownerUser = (await guild.fetchOwner())?.user ?? null;
    } catch { /* ignore */ }
  }

  let dmOk = false;
  if (ownerUser) {
    dmOk = Boolean(await ownerUser.send({ content: text }).catch(() => null));
  }

  let channelOk = false;
  const textId = getMasterChannels(guild.id).textChannelId;
  let ch = textId ? guild.channels.cache.get(textId) : null;
  if (!ch && textId) {
    ch = await guild.channels.fetch(textId).catch(() => null);
  }
  if (ch?.isTextBased?.()) {
    const mention = guild.ownerId ? `<@${guild.ownerId}> ` : '';
    channelOk = Boolean(await ch.send({ content: `${mention}${text}` }).catch(() => null));
  }

  return {
    ok: dmOk || channelOk,
    dm: dmOk,
    channel: channelOk,
    ownerId: guild.ownerId,
  };
}

module.exports = { notifyGuildOwnerBotInvite };
