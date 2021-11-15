const { testDbProvider } = require("./testUtil");

describe("db::address", () => {
  const withTestDb = testDbProvider();

  async function asAddress(client, input) {
    const res = await client.query("SELECT $1::address AS output", [input]);
    return res.rows[0].output;
  }

  it(
    "accepts a '\\x'-prefixed hex address",
    withTestDb(async ({ client }) => {
      const hex = "Efa7bDD92B5e9CD9dE9b54AC0e3dc60623F1C989";
      const input = "\\x" + hex;
      const expected = Buffer.from(hex, "hex");
      expect(await asAddress(client, input)).toEqual(expected);
    })
  );

  it(
    "accepts the zero address",
    withTestDb(async ({ client }) => {
      const input = "\\x" + "00".repeat(20);
      const expected = Buffer.alloc(20);
      expect(await asAddress(client, input)).toEqual(expected);
    })
  );

  it(
    "accepts SQL `NULL`",
    withTestDb(async ({ client }) => {
      expect(await asAddress(client, null)).toEqual(null);
    })
  );

  it(
    "rejects an empty bytestring",
    withTestDb(async ({ client }) => {
      const input = "\\x";
      expect(() => asAddress(client, input)).rejects.toThrow("address_length");
    })
  );

  it(
    "rejects a `bytes32` string",
    withTestDb(async ({ client }) => {
      const input = "\\x" + "de".repeat(32);
      expect(() => asAddress(client, input)).rejects.toThrow("address_length");
    })
  );

  it(
    "rejects a '0x'-prefixed text string",
    withTestDb(async ({ client }) => {
      const hex = "Efa7bDD92B5e9CD9dE9b54AC0e3dc60623F1C989";
      const input = "0x" + hex;
      // This is treated as a length-42 byte array ('0', 'x', 'E', 'f', ...),
      // and so is too long.
      expect(() => asAddress(client, input)).rejects.toThrow("address_length");
    })
  );
});
