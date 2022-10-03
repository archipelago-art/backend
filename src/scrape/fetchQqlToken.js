const { fetchWithRetries } = require("./retryFetch");

const TOKEN_URL_BASE = "https://token.qql.art/qql";

async function fetchTokenJsonText(tokenIndex) {
  const url = `${TOKEN_URL_BASE}/${String(tokenIndex)}`;
  try {
    const { text, res } = await fetchWithRetries(url);
    return text;
  } catch (e) {
    if (e.res && e.res.status === 404) return null;
    throw e;
  }
}

function parseTokenData(text) {
  if (text == null) return { found: false };
  try {
    return { found: true, data: JSON.parse(text) };
  } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
}

async function fetchTokenData(tokenIndex) {
  return parseTokenData(await fetchTokenJsonText(tokenIndex));
}

module.exports = {
  fetchTokenJsonText,
  parseTokenData,
  fetchTokenData,
};
