const opensea = require("./opensea");
const { testDbProvider } = require("./testUtil");

describe("db/opensea", () => {
  const withTestDb = testDbProvider();
  it(
    "permits adding and getting events",
    withTestDb(async ({ client }) => {
      const events = [
        { id: "1", foo: 1 },
        { id: "2", foo: 4 },
        { id: "3", foo: 9 },
      ];
      await opensea.addEvents({ client, events });
      const retrieved = await opensea.getUnconsumedEvents({ client, limit: 3 });
      const expected = events.map((x) => ({ eventId: x.id, json: x }));
      expect(retrieved).toEqual(expected);
    })
  );
  it(
    "tracks event consumption",
    withTestDb(async ({ client }) => {
      const events = [
        { id: "1", foo: 1 },
        { id: "2", foo: 4 },
        { id: "3", foo: 9 },
      ];
      await opensea.addEvents({ client, events });
      await opensea.consumeEvents({ client, eventIds: ["1", "2"] });
      const retrieved = await opensea.getUnconsumedEvents({ client, limit: 3 });
      const expected = events.slice(2).map((x) => ({ eventId: x.id, json: x }));
      expect(retrieved).toEqual(expected);
    })
  );
  it(
    "last updated is null if never set for a slug",
    withTestDb(async ({ client }) => {
      const slug = "awesome-drop-by-archipelago";
      const result = await opensea.getLastUpdated({ client, slug });
      expect(result).toEqual(null);
    })
  );
  it(
    "last updated may be set and retrieved",
    withTestDb(async ({ client }) => {
      const slug = "awesome-drop-by-archipelago";
      const until = new Date("2021-01-01");
      await opensea.setLastUpdated({ client, slug, until });
      const result = await opensea.getLastUpdated({ client, slug });
      expect(result).toEqual(until);
    })
  );
});
