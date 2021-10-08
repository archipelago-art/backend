const { testDbProvider } = require("./testUtil");
const { acqrel } = require("./util");

describe("db/util", () => {
  const withTestDb = testDbProvider();

  describe("acqrel", () => {
    it(
      "acquires and releases a client in the happy case",
      withTestDb(async ({ pool }) => {
        const initialCount = pool.totalCount;
        let c1;
        await acqrel(pool, async (client) => {
          c1 = client;
          const { rows } = await client.query("SELECT 1 AS one");
          expect(rows).toEqual([{ one: 1 }]);
        });
        await acqrel(pool, async (client) => {
          expect(client).toBe(c1);
          const { rows } = await client.query("SELECT 2 AS two");
          expect(rows).toEqual([{ two: 2 }]);
        });
      })
    );

    it(
      "resets state after a failed statement in autocommit mode",
      withTestDb(async ({ pool }) => {
        const initialCount = pool.totalCount;
        let c1;
        await acqrel(pool, async (client) => {
          c1 = client;
          await expect(client.query("SELECT 1 + 'one'")).rejects.toThrow();
        });
        await acqrel(pool, async (client) => {
          expect(client).toBe(c1);
          const { rows } = await client.query("SELECT 2 AS two");
          expect(rows).toEqual([{ two: 2 }]);
        });
      })
    );

    it(
      "resets state after a failed statement in a transaction",
      withTestDb(async ({ pool }) => {
        const initialCount = pool.totalCount;
        let c1;
        await acqrel(pool, async (client) => {
          c1 = client;
          await client.query("BEGIN");
          await expect(client.query("SELECT 1 + 'one'")).rejects.toThrow();
        });
        await acqrel(pool, async (client) => {
          expect(client).toBe(c1);
          const { rows } = await client.query("SELECT 2 AS two");
          expect(rows).toEqual([{ two: 2 }]);
        });
      })
    );
  });
});
