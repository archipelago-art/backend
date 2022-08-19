const artblocks = require("../db/artblocks");
const tokens = require("../db/tokens");
const projects = require("../db/projects");
const artacle = require("../artacle/artacle");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function refreshTokenRarity(args) {
  log.info`Beginning refresh token rarity job.`;

  // Get all Artacle collections and create a map for lookups
  const artacleCollections = await artacle.getCollections();
  const artacleMap = new Map(
    artacleCollections.map((c) => [
      `${_buildProjectKey(c.tokenAddress.toLowerCase(), c.subProjectId)}`,
      c,
    ])
  );

  // Get all Archipelago collections
  const archiCollections = await withClient(async (client) => {
    return projects.getAllProjects({ client: client });
  });

  // Loop over Archipelago collections, lookup Artacle collection, and update rarity
  for (const archiCollection of archiCollections) {
    const isFullyMinted = await withClient(async (client) => {
      return projects.isProjectFullyMinted({ client, projectId: archiCollection.projectId });
    });
    if (!isFullyMinted) {
      log.info`Skipping ${archiCollection.slug} because it is not fully minted.`;
      continue;
    }
    const now = new Date();
    const tokenContract = archiCollection.tokenContract.toLowerCase();

    // Get Artacle collection and lookup rarity
    let mapKey = "";
    if (archiCollection.slug === "cryptoadz") {
      mapKey = _buildProjectKey(tokenContract, null); // Cryptoadz is only project on this tokenContract
    } else if (archiCollection.artblocksProjectIndex == null) {
      // Handle non Artblocks projects
      // TODO this is really hacky
      const imgTemp = archiCollection.imageTemplate;
      const subProjectId = imgTemp.substring(
        imgTemp.indexOf("{sz}/") + 5,
        imgTemp.indexOf("/{hi}")
      );
      mapKey = _buildProjectKey(tokenContract, subProjectId);
    } else {
      mapKey = _buildProjectKey(
        tokenContract,
        archiCollection.artblocksProjectIndex
      );
    }

    const artacleCollection = artacleMap.get(mapKey);
    if (!artacleCollection) {
      log.info`Collection ${archiCollection.slug} not found in Artacle.`;
      continue;
    }
    const artacleRarity = await artacle.getCollectionRarity(
      artacleCollection.id
    );
    log.info`Rarity retrieved for ${archiCollection.slug}`;

    // Get all tokens in the Archipelago collection and create onChainTokenId -> token map for lookups
    const collectionTokens = await withClient(async (client) => {
      return artblocks.getProjectTokens({
        client: client,
        projectId: archiCollection.projectId,
      });
    });
    const tokensMap = new Map(
      collectionTokens.map((t) => [t.onChainTokenId, t])
    );

    // Build list of updates for collection and persist to database
    const updates = [];
    for (const artacleToken of artacleRarity) {
      const archipelagoToken = tokensMap.get(artacleToken.tokenId);
      if (archipelagoToken) {
        updates.push([archipelagoToken.tokenId, artacleToken.rank, now]);
      } else {
        log.info`TokenID ${artacleToken.tokenId} not found in Archipelago DB.`;
      }
    }
    await withClient(async (client) => {
      tokens.updateTokenRarity({ client, updates });
    });
    log.info`Updated rarity for ${updates.length} tokens in ${archiCollection.slug}`;
  }

  log.info`Refresh token rarity job complete.`;
}

// TODO will this key work when the Artacle subProjectId is null?
function _buildProjectKey(tokenContract, subProjectId) {
  return `${tokenContract}-${subProjectId}`;
}

module.exports = refreshTokenRarity;
