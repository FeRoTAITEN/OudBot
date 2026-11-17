// channelStatus.js – T58c: tell "room deleted" apart from "could not check right now".
// A network error, timeout or missing access must never be treated as a deleted room
// (that used to erase saved rooms and recreate the Oud room during outages).
'use strict';
const { ChannelType } = require('discord.js');

const UNKNOWN_CHANNEL = 10003;

/**
 * @returns {Promise<{ status: 'ok'|'gone'|'unknown', channel: import('discord.js').VoiceChannel|null }>}
 *   ok = voice room exists; gone = Discord says it does not exist (or is not a voice room);
 *   unknown = could not tell (network, rate limit, missing access).
 */
async function voiceChannelStatus(guild, channelId) {
  if (!guild || !channelId) return { status: 'gone', channel: null };
  const cached = guild.channels?.cache?.get(channelId);
  if (cached?.type === ChannelType.GuildVoice && (!cached.guildId || cached.guildId === guild.id)) {
    return { status: 'ok', channel: cached };
  }
  try {
    const ch = await guild.channels.fetch(channelId, { force: true });
    if (ch?.type === ChannelType.GuildVoice && (!ch.guildId || ch.guildId === guild.id)) return { status: 'ok', channel: ch };
    return { status: 'gone', channel: null };
  } catch (err) {
    if (err?.code === UNKNOWN_CHANNEL || err?.status === 404) return { status: 'gone', channel: null };
    return { status: 'unknown', channel: null };
  }
}

module.exports = { voiceChannelStatus, UNKNOWN_CHANNEL };
