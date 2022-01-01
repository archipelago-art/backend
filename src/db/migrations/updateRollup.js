const fs = require("fs");
const util = require("util");

const { ROLLUP_SQL_PATH, generateRollupSql } = require(".");

async function main() {
  require("dotenv").config();
  const sql = await generateRollupSql();
  await util.promisify(fs.writeFile)(ROLLUP_SQL_PATH, sql);
}

main().catch((e) => {
  console.error(e);
  process.exitStatus = process.exitStatus || 1;
});
