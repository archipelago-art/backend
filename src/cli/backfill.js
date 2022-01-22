const backfills = require("../db/backfills");
const { withPool } = require("../db/util");

// usage: backfill <backfill-module-name>
// where <backfill-module-name> is the basename of a file in
// `src/db/backfills`, without the `.js` extension
async function backfill(args) {
  const [backfillName, ...backfillArgs] = args;
  const backfill = backfills[backfillName];
  if (backfill == null) throw new Error("unknown backfill " + backfillName);
  await withPool(async (pool) => {
    await backfill({ pool, args: backfillArgs, verbose: true });
  });
}

module.exports = backfill;
