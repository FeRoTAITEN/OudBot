// roomRoster.js – voice channel attendees / organizers for control panel
const registry = require('../bridge/registry');
const { makeUserSourceKey } = require('../bridge/sourceKey');
const { roomLabel } = require('./roomLabel');

function organizerNeedles() {
  return (process.env.ORGANIZER_ROLE_NAMES || 'organizer,host,moderator,mod')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function hasOrganizerRole(member) {
  if (!member?.roles?.cache) return false;
  const needles = organizerNeedles();
  return member.roles.cache.some(role =>
    needles.some(n => role.name.toLowerCase().includes(n)),
  );
}

function membersInVoiceChannel(guild, channelId) {
  if (!guild || !channelId) return [];
  const out = [];
  for (const [, vs] of guild.voiceStates.cache) {
    if (vs.channelId !== channelId || vs.member?.user?.bot) continue;
    out.push(vs.member);
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function memberUsername(member) {
  const u = member.user;
  if (!u) return '';
  return u.discriminator && u.discriminator !== '0'
    ? `${u.username}#${u.discriminator}`
    : `@${u.username}`;
}

function memberLine(member) {
  const vs = member.voice;
  const state = vs?.selfMute ? '🔇' : vs?.selfDeaf ? '🔈' : '🎤';
  const uname = memberUsername(member);
  return `${state} **${member.displayName}** · \`${uname}\``;
}

function formatMemberList(members, max = 12) {
  if (!members.length) return null;
  const shown = members.slice(0, max);
  let text = shown.map(memberLine).join('\n');
  if (members.length > max) text += `\n_+${members.length - max} more_`;
  return text.slice(0, 1024);
}

/**
 * @returns {{ organizers: string|null, attendees: string|null, count: number }}
 */
function getRoomRoster(guild, channelId) {
  const members = membersInVoiceChannel(guild, channelId);
  const organizers = members.filter(hasOrganizerRole);
  const guests = organizers.length
    ? members.filter(m => !organizers.includes(m))
    : [];

  return {
    count: members.length,
    organizers: organizers.length ? formatMemberList(organizers) : null,
    attendees: guests.length ? formatMemberList(guests) : null,
    everyone: !organizers.length ? formatMemberList(members) : null,
  };
}

/** Everyone in slave voice channels who can be bridged (for per-person mute). */
function getBridgeSpeakers(guild, slaveName = null) {
  if (!guild) return [];
  const filter = slaveName != null ? String(slaveName) : null;
  const out = [];
  for (const slave of registry.getSlaveSnapshots(guild.id)) {
    if (filter && slave.name !== filter) continue;
    if (slave.colliding || slave.bridgeEnabled === false || slave.paused) continue;
    const members = membersInVoiceChannel(guild, slave.channelId);
    // T77 (review B5): who is talking right now (same signal as the dashboard glow).
    const talking = new Set((slave.members || []).filter(m => m.speaking).map(m => String(m.id)));
    for (const member of members) {
      out.push({
        userId: member.id,
        displayName: member.displayName,
        slaveName: slave.name,
        roomLabel: roomLabel(guild, slave),
        sourceKey: makeUserSourceKey(slave.name, member.id, guild.id),
        speaking: talking.has(String(member.id)),
      });
    }
  }
  return out.sort((a, b) => Number(b.speaking) - Number(a.speaking)
    || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
}

module.exports = {
  membersInVoiceChannel,
  getRoomRoster,
  getBridgeSpeakers,
};
