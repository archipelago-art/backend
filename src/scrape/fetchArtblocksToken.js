const fetch = require("node-fetch");
const htmlParser = require("node-html-parser");

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
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok)
    throw new Error(`fetching ${url}: ${res.status} ${res.statusText}`);
  return await res.text();
}

function parseTokenData(text) {
  if (text == null) {
    return { found: false };
  }
  try {
    return { found: true, raw: text, parsed: JSON.parse(text) };
  } catch (e) {
    throw new Error(`parsing ${url}: invalid JSON: ${e.message}`);
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
