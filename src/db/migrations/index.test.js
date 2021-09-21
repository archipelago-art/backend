const { testDbProvider } = require("../testUtil");

const migrations = require(".");

describe("db/migrations", () => {
  const withTestDb = testDbProvider();
  it(
    "applies all migrations to a fresh DB",
    withTestDb(async ({ client }) => {
      await migrations.applyAll({ client });
    })
  );
});
