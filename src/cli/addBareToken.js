const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function addBareToken(args) {
  const [artblocksTokenId] = args;
  const { tokenId } = await withClient(async (client) => {
    return await artblocks.addBareToken({ client, artblocksTokenId });
  });
  log.info`added bare Art Blocks token ${artblocksTokenId} with ID ${tokenId}`;
}

module.exports = addBareToken;
