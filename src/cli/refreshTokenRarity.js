const api = require("../api");
const fetcher = require("../artacle/fetcher");
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

  // Update artacle_projects table
  const artacleProjects = [];
  for (const archiCollection of archiCollections) {
    const tokenContract = archiCollection.tokenContract.toLowerCase();
    const mapKey = _buildProjectKey(
      tokenContract,
      archiCollection.artblocksProjectIndex
    );
    const artacleCollection = artacleCollectionMap.get(mapKey);
    if (artacleCollection) {
      artacleProjects.push({
        projectId: archiCollection.projectId,
        artacleSlug: artacleCollection.slug,
      });
    }
  }
  await withClient(async (client) => {
    artacle.updateArtacleProjects({ client, updates: artacleProjects });
  });
  log.info`Updated artacle_projects table with ${artacleProjects.length} entries.`;

  // Loop over Archipelago collections, lookup Artacle collection, and update rarity
  for (const archiCollection of archiCollections) {
    const isFullyMinted = await withClient(async (client) => {
      return projects.isProjectFullyMinted({
        client,
        projectId: archiCollection.projectId,
      });
    });
    // TODO: Temp fix to allow Chromie Squiggle to be updated
    if (!isFullyMinted && archiCollection.slug !== "chromie-squiggle") {
      log.info`Skipping ${archiCollection.slug} because it is not fully minted.`;
      continue;
    }
    const tokenContract = archiCollection.tokenContract.toLowerCase();

    // Get Artacle collection, lookup rarity, and update
    const mapKey = _buildProjectKey(
      tokenContract,
      archiCollection.artblocksProjectIndex
    );
    const artacleCollection = artacleCollectionMap.get(mapKey);
    if (!artacleCollection) {
      log.info`Collection ${archiCollection.slug} not found in Artacle.`;
      continue;
    }

    // Get rarity for collection
    const { artacleRarity, isFinalized } = await fetcher.getCollectionRarity(
      artacleCollection.id
    );
    const artacleRarityMap = new Map(
      artacleRarity.map((r) => [r.tokenId, r.rank])
    );
    log.info`Rarity retrieved for ${archiCollection.slug}`;
    if (!isFinalized && archiCollection.slug !== "chromie-squiggle") {
      log.info`Rarity for collection ${archiCollection.slug} is not finalized. Skipping.`;
      continue;
    }

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

function _buildProjectKey(tokenContract, subProjectId) {
  return `${tokenContract}-${subProjectId}`;
}

module.exports = refreshTokenRarity;
