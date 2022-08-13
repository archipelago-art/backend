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
      `${_buildProjectKey(c.tokenAddress, c.subProjectId)}`,
      c,
    ])
  );

  // Get all Archipelago collections
  const archipelagoCollections = await withClient(async (client) => {
    return projects.getAllProjects({ client: client });
  });

  // Loop over Archipelago collections, lookup Artacle collection, and update rarity
  for (const archipelagoCollection of archipelagoCollections) {
    const artacleCollection = artacleMap.get(
      _buildProjectKey(
        archipelagoCollection.tokenContract.toLowerCase(),
        archipelagoCollection.artblocksProjectIndex
      )
    );
    const artacleRarity = await artacle.getCollectionRarity(artacleCollection.id);
    //TODO update rarity
    // tokens.updateTokenRarity({...
  }

  // TODO will this key work when the Artacle subProjectId is null?
  function _buildProjectKey(tokenAddress, artblocksId) {
    let test = `${tokenAddress}-${artblocksId}`;
    return test;
  }

  log.info`Refresh token rarity job complete.`;
}

module.exports = refreshTokenRarity;
