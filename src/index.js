var pg = require("pg");

const migrations = require("./db/migrations");
const { testDbProvider } = require("./db/testUtil");
const dbutil = require("./db/util");

async function main() {
  require("dotenv").config();

  const withDb = testDbProvider();

  const testCase = withDb(async ({ database, pool }, arg) => {
    await dbutil.acqrel(pool, async (client) => {
      await migrations.applyAll({ client });
    });
    console.log(
      database,
      (await pool.query("SELECT COUNT(1) FROM projects")).rows,
      arg
    );
    return arg * 2;
  });

  console.log(await testCase(21));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = process.exitCode || 1;
});
