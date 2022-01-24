const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);
const sortAsciinumeric = require("../util/sortAsciinumeric");

async function dumpTraitOrdering() {
  const res = await withClient(async (client) => {
    return artblocks.getAllFeaturesAndTraitsOnly({ client });
  });
  for (const row of res) {
    row.traitValues = sortAsciinumeric(row.traitValues, (t) => String(t));
    console.log(JSON.stringify(row));
  }
}

module.exports = dumpTraitOrdering;
