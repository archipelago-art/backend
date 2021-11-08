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
  try {
    const { text, res } = await fetchWithRetries(url);
    return text;
  } catch (e) {
    if (e.res && e.res.status === 404) return null;
    throw e;
  }
}

function parseTokenData(text) {
  if (text == null) {
    return { found: false };
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed.features) throw new Error(`no "features": ${text}`);
    // The Art Blocks API has been known to simply omit the features for some
    // tokens [1]. If this happens again, fail instead of inserting bad data.
    //
    // [1]: https://discord.com/channels/411959613370400778/887136427241009253/892503024784793650
    if (!Object.keys(parsed.features).length)
      throw new Error(`empty "features": ${text}`);
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
