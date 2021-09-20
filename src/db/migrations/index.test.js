const { testDbProvider } = require("../testUtil");
const { acqrel } = require("../util");

const migrations = require(".");

describe("db/migrations", () => {
  const withTestDb = testDbProvider();
  it(
    "applies all migrations to a fresh DB",
    withTestDb(async ({ pool }) => {
      await acqrel(pool, async (client) => {
        await migrations.applyAll({ client });
      });
    })
  );
});
