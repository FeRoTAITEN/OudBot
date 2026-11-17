function extractErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

function isRecoverableNetworkError(err) {
  const msg = extractErrorMessage(err);
  return /EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|Connect Timeout|socket closed|Unexpected server response: 5\d\d|getaddrinfo/i.test(msg);
}

module.exports = {
  extractErrorMessage,
  isRecoverableNetworkError,
};
