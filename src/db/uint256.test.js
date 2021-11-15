const { testDbProvider } = require("./testUtil");

describe("db::uint256", () => {
  const withTestDb = testDbProvider();

  async function asUint256(client, input) {
    const res = await client.query("SELECT $1::uint256 AS output", [input]);
    return res.rows[0].output;
  }

  it(
    "accepts 0",
    withTestDb(async ({ client }) => {
      expect(await asUint256(client, 0)).toEqual("0");
    })
  );

  it(
    "accepts 2^256 - 1",
    withTestDb(async ({ client }) => {
      const max = (1n << 256n) - 1n;
      expect(await asUint256(client, String(max))).toEqual(String(max));
    })
  );

  it(
    "accepts SQL `NULL`",
    withTestDb(async ({ client }) => {
      expect(await asUint256(client, null)).toEqual(null);
    })
  );

  it(
    "rejects -1",
    withTestDb(async ({ client }) => {
      expect(() => asUint256(client, -1)).rejects.toThrow(
        "uint256_nonnegative"
      );
    })
  );

  it(
    "rejects 2^256",
    withTestDb(async ({ client }) => {
      expect(() => asUint256(client, String(1n << 256n))).rejects.toThrow(
        "uint256_range"
      );
    })
  );

  it(
    "rejects NaN",
    withTestDb(async ({ client }) => {
      // Docs specify NaN is considered greater than all non-NaN values, so
      // this is well defined.
      expect(() => asUint256(client, "NaN")).rejects.toThrow("uint256_range");
    })
  );
});
