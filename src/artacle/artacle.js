const { fetchWithRetries } = require("../scrape/retryFetch");

const apiKey = process.env.ARTACLE_API_KEY;
const artacleApiBase = "https://api.artacle.io/v1";
const artacleLimit = 1000;

async function getCollections() {
  return await _paginated_fetch(`${artacleApiBase}/collections`);
}

async function getCollectionRarity(artblocksCollectionIndex) {
  return await _paginated_fetch(
    `${artacleApiBase}/collections/${artblocksCollectionIndex}/rarity`
  );
}

async function getTokenRarity(artblocksCollectionId, artblocksTokenId) {
  const response = await fetchWithRetries(
    `${artacleApiBase}/collections/${artblocksCollectionId}/token/${artblocksTokenId}/rarity`
  );
  return await JSON.parse(response.text).data;
}

async function _paginated_fetch(url) {
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
    await _sleep(100);
  } while (lastLength == artacleLimit);
  return results;
}

function _sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

module.exports = { getCollections, getCollectionRarity, getTokenRarity };
