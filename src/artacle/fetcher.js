const { fetchWithRetries } = require("../scrape/retryFetch");

const artacleApiBase = "https://api.artacle.io/v1";
const artacleLimit = 1000;

async function getCollections() {
  return await _paginatedFetch(`${artacleApiBase}/collections`);
}

async function getCollectionRarity(artblocksCollectionIndex) {
  return await _paginatedFetch(
    `${artacleApiBase}/collections/${artblocksCollectionIndex}/rarity`
  );
}

async function getTokenRarity(artblocksCollectionId, artblocksTokenId) {
  const response = await fetchWithRetries(
    `${artacleApiBase}/collections/${artblocksCollectionId}/token/${artblocksTokenId}/rarity`
  );
  return await JSON.parse(response.text).data;
}

async function _paginatedFetch(url) {
  const apiKey = process.env.ARTACLE_API_KEY;
  let offset = 0;
  let results = [];
  let lastLength = 0;

  do {
    const responseRaw = await fetchWithRetries(
      `${url}?apiKey=${apiKey}&offset=${offset}&limit=${artacleLimit}`
    );
    const responseJson = await JSON.parse(responseRaw.text);
    results = results.concat(responseJson.data);
    lastLength = responseJson.data.length;
    offset += artacleLimit;
    await sleepMs(100);
  } while (lastLength == artacleLimit);
  return results;
}

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = { getCollections, getCollectionRarity, getTokenRarity };
