const { testDbProvider } = require("./testUtil");
const { columnExists, tableExists } = require("./introspection");

describe("db/introspection", () => {
  const withTestDb = testDbProvider({ migrate: false });

  describe("tableExists", () => {
    it(
      "properly detects existence of normal tables",
      withTestDb(async ({ client }) => {
        await client.query("BEGIN");
        const table = "my_test_table";
        expect(await tableExists({ client, table })).toBe(false);
        await client.query("CREATE TABLE my_test_table(x int PRIMARY KEY)");
        expect(await tableExists({ client, table })).toBe(true);
        await client.query("ROLLBACK");
      })
    );

    it(
      "properly detects existence of views",
      withTestDb(async ({ client }) => {
        await client.query("BEGIN");
        const table = "my_test_view";
        expect(await tableExists({ client, table })).toBe(false);
        await client.query("CREATE VIEW my_test_view AS (SELECT 1)");
        expect(await tableExists({ client, table })).toBe(true);
        await client.query("ROLLBACK");
      })
    );

    it(
      "doesn't detect temporary tables (they're not in the `public` schema)",
      withTestDb(async ({ client }) => {
        await client.query("BEGIN");
        const table = "my_temp_table";
        expect(await tableExists({ client, table })).toBe(false);
        await client.query(
          "CREATE TEMPORARY TABLE my_temp_table(x int PRIMARY KEY)"
        );
        expect(await tableExists({ client, table })).toBe(false);
        await client.query("ROLLBACK");
      })
    );

    it(
      "only looks in the given schema",
      withTestDb(async ({ client }) => {
        const table = "tables";
        expect(await tableExists({ client, table })).toBe(false);
        const schema = "information_schema";
        expect(await tableExists({ client, table, schema })).toBe(true);
      })
    );
  });

  describe("columnExists", () => {
    it(
      "properly detects existence of columns",
      withTestDb(async ({ client }) => {
        await client.query(
          "BEGIN; CREATE TABLE t1(x int, y int); CREATE TABLE t2(x int);"
        );
        const table = "t2";
        const column = "y";
        expect(await columnExists({ client, table, column })).toBe(false);
        await client.query("ALTER TABLE t2 ADD COLUMN y int");
        expect(await columnExists({ client, table, column })).toBe(true);
        await client.query("ROLLBACK");
      })
    );

    it(
      "only looks in the given schema",
      withTestDb(async ({ client }) => {
        const table = "columns";
        const column = "column_name";
        expect(await tableExists({ client, table, column })).toBe(false);
        const schema = "information_schema";
        expect(await tableExists({ client, table, column, schema })).toBe(true);
      })
    );
  });
});
