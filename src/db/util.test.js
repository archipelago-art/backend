const { testDbProvider } = require("./testUtil");
const { acqrel, hexToBuf, bufToHex, bufToAddress } = require("./util");

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

  describe("hexToBuf", () => {
    it(
      "properly encodes a bytestring for `pg`",
      withTestDb(async ({ client }) => {
        const res = await client.query("SELECT $1::bytea AS val", [
          hexToBuf("0xabCD"),
        ]);
        expect(res.rows[0].val).toEqual(Buffer.from([0xab, 0xcd]));
      })
    );

    it("rejects a string not starting with '0x'", () => {
      expect(() => hexToBuf("abcd")).toThrow("expected 0x-string; got: abcd");
    });

    it("silently ignores non-hex characters", () => {
      expect(hexToBuf("0xabczde")).toEqual(Buffer.from([0xab]));
    });
  });

  describe("bufToHex", () => {
    it(
      "properly parses a bytestring from `pg`",
      withTestDb(async ({ client }) => {
        const res = await client.query("SELECT $1::bytea AS val", [
          Buffer.from("abcd", "hex"),
        ]);
        expect(bufToHex(res.rows[0].val)).toEqual("0xabcd");
      })
    );
  });

  describe("bufToAddress", () => {
    it(
      "properly parses a bytestring from `pg`",
      withTestDb(async ({ client }) => {
        const res = await client.query("SELECT $1::bytea AS val", [
          Buffer.from("a7d8d9ef8d8ce8992df33d8b8cf4aebabd5bd270", "hex"),
        ]);
        expect(bufToAddress(res.rows[0].val)).toEqual(
          "0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270"
        );
      })
    );
  });
});
