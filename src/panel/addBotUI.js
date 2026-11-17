const {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { t } = require('../i18n/context');

const MODAL_ID = 'bridge:addbotmodal';

function parseAddBotModalId(customId) {
  return customId === MODAL_ID ? { ok: true } : null;
}

function buildAddBotModal() {
  return new ModalBuilder()
    .setCustomId(MODAL_ID)
    .setTitle(t('modal.addBot'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('bot_token')
          .setLabel(t('modal.addToken'))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder(t('modal.addTokenPh'))
          .setMinLength(20)
          .setMaxLength(200),
      ),
    );
}

module.exports = {
  parseAddBotModalId,
  buildAddBotModal,
};
