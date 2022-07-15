const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);

async function addToken(args) {
  if (args.length !== 2) {
    throw new Error(`usage: add-token tokenContract artblocksTokenId`);
  }
  const [tokenContract, artblocksTokenId] = args;
  const token = await fetchTokenData(tokenContract, artblocksTokenId);
  if (!token.found) {
    log.info`token not found; nothing to add`;
    return;
  }
  const tokenId = await withClient(async (client) => {
    return await artblocks.addToken({
      client,
      artblocksTokenId,
      rawTokenData: token.raw,
      tokenContract,
    });
  });
  log.info`added Art Blocks token ${artblocksTokenId} with ID ${tokenId}`;
}

module.exports = addToken;
