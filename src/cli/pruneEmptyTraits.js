const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function pruneEmptyTraits() {
  const res = await withClient(async (client) => {
    return artblocks.pruneEmptyFeaturesAndTraits({ client });
  });
  log.info`pruned ${res.traits} traits and ${res.features} features`;
}

module.exports = pruneEmptyTraits;
