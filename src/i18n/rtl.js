/** Force RTL paragraph direction in Discord embeds (Arabic). */
const RLM = '\u200F';

function rtlLine(line) {
  if (!line) return RLM;
  return line.startsWith(RLM) ? line : `${RLM}${line}`;
}

function rtlBlock(text) {
  return String(text).split('\n').map(rtlLine).join('\n');
}

module.exports = { RLM, rtlLine, rtlBlock };
