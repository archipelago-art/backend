const api = require("../api");
const fetcher = require("../artacle/artacle");
const artacle = require("../db/artacle");
const artblocks = require("../db/artblocks");
const projects = require("../db/projects");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function refreshTokenRarity(args) {
  log.info`Beginning refresh token rarity job.`;

  // Get all Artacle collections and create a map for lookups
  const artacleCollections = await fetcher.getCollections();
  const artacleCollectionMap = new Map(
    artacleCollections.map((c) => [
      `${_buildProjectKey(c.tokenAddress.toLowerCase(), c.subProjectId)}`,
      c,
    ])
  );

  // Get all Archipelago collections
  const archiCollections = await withClient(async (client) => {
    return api.collections({ client });
  });

  // Loop over Archipelago collections, lookup Artacle collection, and update rarity
  for (const archiCollection of archiCollections) {
    const isFullyMinted = await withClient(async (client) => {
      return projects.isProjectFullyMinted({
        client,
        projectId: archiCollection.projectId,
      });
    });
    if (!isFullyMinted) {
      log.info`Skipping ${archiCollection.slug} because it is not fully minted.`;
      continue;
    }
    const tokenContract = archiCollection.tokenContract.toLowerCase();

    // Get Artacle collection and lookup rarity
    const mapKey = _buildProjectKey(
      tokenContract,
      archiCollection.artblocksProjectIndex
    );
    const artacleCollection = artacleCollectionMap.get(mapKey);
    if (!artacleCollection) {
      log.info`Collection ${archiCollection.slug} not found in Artacle.`;
      continue;
    }
    const artacleRarity = await artacle.getCollectionRarity(
      artacleCollection.id
    );
    const artacleRarityMap = new Map(
      artacleRarity.map((r) => [r.tokenId, r.rank])
    );
    log.info`Rarity retrieved for ${archiCollection.slug}`;

    // Get all tokens in the Archipelago collection and create onChainTokenId -> token map for lookups
    const collectionTokens = await withClient(async (client) => {
      return artblocks.getProjectTokens({
        client: client,
        projectId: archiCollection.projectId,
      });
    });

    // Build list of updates for collection and persist to database
    const updates = [];
    let nullCount = 0;
    for (const token of collectionTokens) {
      const artacleRank = artacleRarityMap.get(token.onChainTokenId);
      updates.push({
        tokenId: token.tokenId,
        rarityRank: artacleRank ?? null,
      });
      if (artacleRank == null) nullCount++;
    }
    await withClient(async (client) => {
      artacle.updateTokenRarity({ client, updates });
    });
    log.info`Updated rarity for ${updates.length} tokens (${nullCount} null) in ${archiCollection.slug}`;
  }

  log.info`Refresh token rarity job complete.`;
}

// TODO will this key work when the Artacle subProjectId is null?
function _buildProjectKey(tokenContract, subProjectId) {
  return `${tokenContract}-${subProjectId}`;
}

module.exports = refreshTokenRarity;
