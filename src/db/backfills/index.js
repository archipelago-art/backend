const backfillModules = [
  "./artblocksFetchTime",
  "./blocks",
  "./nonStringTraits",
  "./openseaEventTypes",
  "./populateOpenseaIngestionQueue",
  "./openseaInvalidateAsksWithSubsequentSale",
  "./openseaSkipPrivateAsks",
  "./abConceptMigrations",
  "./projectsImageTemplate",
  "./openseaReingestCancellations",
  // ...
];

const backfills = (() => {
  const backfills = {};
  for (const path of backfillModules) {
    const name = path.replace(/.*\//, "");
    if (backfills[name] != null) throw new Error("duplicate backfill: " + name);
    backfills[name] = require(path);
  }
  return Object.freeze(backfills);
})();

module.exports = backfills;
