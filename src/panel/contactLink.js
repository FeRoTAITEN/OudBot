const { ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('../i18n/context');

function getContactLink() {
  const url = process.env.DEFAULT_CONTACT_URL?.trim();
  if (!url) return null;
  const envLabel = process.env.DEFAULT_CONTACT_LABEL?.trim();
  return {
    url,
    label: (envLabel || t('contact.label')).slice(0, 80),
  };
}

function contactLinkButton() {
  const contact = getContactLink();
  if (!contact?.url) return null;
  return new ButtonBuilder()
    .setLabel(contact.label)
    .setStyle(ButtonStyle.Link)
    .setURL(contact.url)
    .setEmoji('📩');
}

module.exports = { getContactLink, contactLinkButton };
