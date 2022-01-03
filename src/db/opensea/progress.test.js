const { setLastUpdated, getLastUpdated } = require("./progress");
const { testDbProvider } = require("../testUtil");

describe("db/opensea/progress", () => {
  const withTestDb = testDbProvider();
  it(
    "last updated is null if never set for a slug",
    withTestDb(async ({ client }) => {
      const slug = "awesome-drop-by-archipelago";
      const result = await getLastUpdated({ client, slug });
      expect(result).toEqual(null);
    })
  );
  it(
    "last updated may be set and retrieved",
    withTestDb(async ({ client }) => {
      const slug = "awesome-drop-by-archipelago";
      const until = new Date("2021-01-01");
      await setLastUpdated({ client, slug, until });
      const result = await getLastUpdated({ client, slug });
      expect(result).toEqual(until);
    })
  );
});
