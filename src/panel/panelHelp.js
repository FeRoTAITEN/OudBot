const { EmbedBuilder } = require('discord.js');
const { t } = require('../i18n/context');
const { guildBridgeEnabled, guildSlavesEnabled } = require('./guildPanelFeatures');

function buildPanelHelpEmbed(guild = null) {
  const bridge = guild ? guildBridgeEnabled(guild) : true;
  const slavesOn = guild ? guildSlavesEnabled(guild) : false;
  const fields = [
    {
      name: t('help.access'),
      value: t('help.accessVal'),
      inline: false,
    },
    {
      name: t('help.overview'),
      value: bridge
        ? t('help.overviewVal')
        : (slavesOn ? t('help.overviewValSlaves') : t('help.overviewValMusic')),
      inline: false,
    },
  ];

  if (!bridge) {
    fields.push({
      name: t('help.subscriptionHelp'),
      value: t('help.subscriptionHelpVal'),
      inline: false,
    });
  }

  if (bridge) {
    fields.push({
      name: t('help.mixer'),
      value: t('help.mixerVal'),
      inline: false,
    });
  }

  fields.push(
    {
      name: t('help.master'),
      value: bridge ? t('help.masterVal') : t('help.masterValMusic'),
      inline: false,
    },
    {
      name: t('help.rooms'),
      value: bridge ? t('help.roomsVal') : (slavesOn ? t('help.roomsVal') : t('help.roomsValMusic')),
      inline: false,
    },
    {
      name: t('help.edit'),
      value: bridge
        ? t('help.editVal')
        : (slavesOn ? t('help.editValSlaves') : t('help.editValMusic')),
      inline: false,
    },
    {
      name: t('help.health'),
      value: bridge ? t('help.healthVal') : t('help.healthValMusic'),
      inline: false,
    },
  );

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(t('help.title'))
    .addFields(fields);
}

module.exports = { buildPanelHelpEmbed };
