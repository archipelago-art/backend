const htmlParser = require("node-html-parser");

const { fetchWithRetries } = require("./retryFetch");

const TOKEN_URL_BASE = "https://api.artblocks.io/token";

const PROJECTS_THAT_MUST_HAVE_FEATURES = [194, 204];

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
    const projectId = Number(parsed.project_id);
    if (isNaN(projectId))
      throw new Error(`bad project ID: ${parsed.project_id}`);
    // Hacky workaround for latency on Art Blocks API, wherein a token mints
    // and the Art Blocks API returns data for it but omits all features from
    // the response (???).
    if (
      PROJECTS_THAT_MUST_HAVE_FEATURES.includes(projectId) &&
      !Object.keys(parsed.features).length
    )
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
