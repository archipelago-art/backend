const { testDbProvider } = require("./testUtil");

describe("db::hexaddr", () => {
  const withTestDb = testDbProvider();

  async function hexaddr(client, input) {
    const res = await client.query("SELECT hexaddr($1) AS output", [input]);
    return res.rows[0].output;
  }

  it(
    "accepts a '0x'-prefixed hex address",
    withTestDb(async ({ client }) => {
      const hex = "Efa7bDD92B5e9CD9dE9b54AC0e3dc60623F1C989";
      const input = "0x" + hex;
      const expected = Buffer.from(hex, "hex");
      expect(await hexaddr(client, input)).toEqual(expected);
    })
  );

  it(
    "accepts the zero address",
    withTestDb(async ({ client }) => {
      const input = "0x" + "00".repeat(20);
      const expected = Buffer.alloc(20);
      expect(await hexaddr(client, input)).toEqual(expected);
    })
  );

  it(
    "accepts SQL `NULL`",
    withTestDb(async ({ client }) => {
      expect(await hexaddr(client, null)).toEqual(null);
    })
  );

  it(
    "rejects the string '0x' with no data",
    withTestDb(async ({ client }) => {
      const input = "0x";
      expect(() => hexaddr(client, input)).rejects.toThrow("address_length");
    })
  );

  it(
    "rejects a '0x'-prefixed string with 32 bytes of data",
    withTestDb(async ({ client }) => {
      const input = "0x" + "de".repeat(32);
      expect(() => hexaddr(client, input)).rejects.toThrow("address_length");
    })
  );
});
