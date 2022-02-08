const { ObjectType, newId } = require("./id");
const { testDbProvider } = require("./testUtil");

describe("db::idTypes", () => {
  const withTestDb = testDbProvider();

  const DB_TYPES = {
    [ObjectType.TOKEN]: "tokenid",
    [ObjectType.PROJECT]: "projectid",
    [ObjectType.FEATURE]: "featureid",
    [ObjectType.TRAIT]: "traitid",
    [ObjectType.CURRENCY]: "currencyid",
    [ObjectType.BID]: "bidid",
    [ObjectType.ASK]: "askid",
    [ObjectType.CNF]: "cnfid",
  };

  for (const [idTypeName, idType] of Object.entries(ObjectType)) {
    const dbType = DB_TYPES[idType];
    if (dbType == null) {
      throw new Error(`missing DB type listing for ${idTypeName}`);
    }
    if (typeof dbType !== "string" || !dbType.match(/^[a-z_][a-z0-9_]*$/)) {
      throw new Error(`type name may not be a SQL-safe identifier: ${dbType}`);
    }
    describe(dbType, () => {
      it(
        "accepts a new ID",
        withTestDb(async ({ client }) => {
          const id = newId(idType);
          const res = await client.query(`SELECT $1::${dbType} AS id`, [id]);
          expect(res.rows).toEqual([{ id }]);
        })
      );

      if (Object.keys(ObjectType).length > 1) {
        const otherIdType = Object.keys(DB_TYPES).find(
          (x) => x !== String(idType)
        );
        it(
          "rejects an ID from a different type",
          withTestDb(async ({ client }) => {
            const id = newId(otherIdType);
            await expect(() =>
              client.query(`SELECT $1::${dbType} AS id`, [id])
            ).rejects.toThrow(`${dbType}_type`);
          })
        );
      }
    });
  }
});
