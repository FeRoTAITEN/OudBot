const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { slaveRoomLabel } = require('./roomLabel');
const { t } = require('../i18n/context');

function removeBotModalId(botKey) {
  return `bridge:removebotmodal:${botKey}`;
}

function parseRemoveBotModalId(customId) {
  if (!customId?.startsWith('bridge:removebotmodal:')) return null;
  const botKey = customId.slice('bridge:removebotmodal:'.length);
  return botKey ? { botKey } : null;
}

function buildRemoveBotModal(botKey, guild) {
  const label = slaveRoomLabel(guild, botKey);
  return new ModalBuilder()
    .setCustomId(removeBotModalId(botKey))
    .setTitle(t('modal.removeBot', { key: botKey }).slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('confirm')
          .setLabel(t('modal.removeConfirm'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder(label.slice(0, 100) || `${t('common.slave')} #${botKey}`)
          .setMinLength(6)
          .setMaxLength(10),
      ),
    );
}

module.exports = {
  removeBotModalId,
  parseRemoveBotModalId,
  buildRemoveBotModal,
};
