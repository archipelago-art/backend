const htmlParser = require("node-html-parser");

const { fetchWithRetries } = require("./retryFetch");

const TOKEN_URL_BASE = "https://api.artblocks.io/token";

function normalizeTokenId(tokenId) {
  const result = Number.parseInt(tokenId, 10);
  if (!Number.isSafeInteger(result))
    throw new Error("Invalid token ID: " + tokenId);
  if (result < 0) throw new Error("Negative token ID: " + tokenId);
  return result;
}

async function fetchTokenJsonText(tokenId) {
  const url = `${TOKEN_URL_BASE}/${normalizeTokenId(tokenId)}`;
  const { text, res } = await fetchWithRetries(url);
  if (res.status === 404) return null;
  return text;
}

function parseTokenData(text) {
  if (text == null) {
    return { found: false };
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed.features) throw new Error(`no "features": ${text}`);
    return { found: true, raw: text, parsed };
  } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
}

async function fetchTokenData(tokenId) {
  return parseTokenData(await fetchTokenJsonText(tokenId));
}

module.exports = {
  fetchTokenJsonText,
  parseTokenData,
  fetchTokenData,
};
