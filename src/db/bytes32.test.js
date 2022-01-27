const { testDbProvider } = require("./testUtil");

describe("db::bytes32", () => {
  const withTestDb = testDbProvider();

  async function asBytes32(client, input) {
    const res = await client.query("SELECT $1::bytes32 AS output", [input]);
    return res.rows[0].output;
  }

  it(
    "accepts a '\\x'-prefixed `bytes32` value",
    withTestDb(async ({ client }) => {
      const hex =
        "d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3";
      const input = "\\x" + hex;
      const expected = Buffer.from(hex, "hex");
      expect(await asBytes32(client, input)).toEqual(expected);
    })
  );

  it(
    "accepts the zero value",
    withTestDb(async ({ client }) => {
      const input = "\\x" + "00".repeat(32);
      const expected = Buffer.alloc(32);
      expect(await asBytes32(client, input)).toEqual(expected);
    })
  );

  it(
    "accepts SQL `NULL`",
    withTestDb(async ({ client }) => {
      expect(await asBytes32(client, null)).toEqual(null);
    })
  );

  it(
    "rejects an empty bytestring",
    withTestDb(async ({ client }) => {
      const input = "\\x";
      expect(() => asBytes32(client, input)).rejects.toThrow("bytes32_length");
    })
  );

  it(
    "rejects a too-short bytestring",
    withTestDb(async ({ client }) => {
      const input = "\\x" + "de".repeat(20);
      expect(() => asBytes32(client, input)).rejects.toThrow("bytes32_length");
    })
  );

  it(
    "rejects a '0x'-prefixed text string",
    withTestDb(async ({ client }) => {
      const hex =
        "d4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3";
      const input = "0x" + hex;
      // This is treated as a length-66 byte array ('0', 'x', 'd', '4', ...),
      // and so is too long.
      expect(() => asBytes32(client, input)).rejects.toThrow("bytes32_length");
    })
  );
});
