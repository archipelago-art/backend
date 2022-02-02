const artblocks = require("../db/artblocks");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);
const slugify = require("../util/slugify");
const { sortAsciinumeric } = require("../util/sortAsciinumeric");

async function dumpTraitOrdering() {
  const res = await withClient(async (client) => {
    return artblocks.getAllFeaturesAndTraitsOnly({ client });
  });
  for (const row of res) {
    console.log(
      "project %s, feature %s, feature slug %s",
      JSON.stringify(row.projectSlug),
      JSON.stringify(row.featureName),
      JSON.stringify(slugify(row.featureName))
    );
    const traits = sortAsciinumeric(row.traitValues, (t) => slugify(String(t)));
    for (const trait of traits) {
      console.log(
        "trait %s, trait slug %s",
        JSON.stringify(trait),
        JSON.stringify(slugify(String(trait)))
      );
    }
    console.log();
  }
}

module.exports = dumpTraitOrdering;
