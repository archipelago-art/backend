const migrations = require("../db/migrations");
const { withPool } = require("../db/util");

async function init() {
  await withPool(async (pool) => {
    await migrations.applyAll({ pool, verbose: true });
  });
}

module.exports = init;
