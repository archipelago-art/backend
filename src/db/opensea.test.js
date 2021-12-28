const dbUtil = require("./util");
const opensea = require("./opensea");
const { testDbProvider } = require("./testUtil");

describe.skip("db/opensea", () => {
  const withTestDb = testDbProvider();
  it(
    "permits adding and getting events",
    withTestDb(async ({ client }) => {
      const events = [
        { id: "1", foo: 1, event_type: "created" },
        { id: "2", foo: 4, event_type: "successful" },
        { id: "3", foo: 9, event_type: "transfer" },
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
        { id: "1", foo: 1, event_type: "transfer" },
        { id: "2", foo: 4, event_type: "transfer" },
        { id: "3", foo: 9, event_type: "transfer" },
      ];
      await opensea.addEvents({ client, events });
      await opensea.consumeEvents({ client, eventIds: ["1", "2"] });
      const retrieved = await opensea.getUnconsumedEvents({ client, limit: 3 });
      const expected = events.slice(2).map((x) => ({ eventId: x.id, json: x }));
      expect(retrieved).toEqual(expected);
    })
  );
  it(
    "can filter by event type as well as consumption",
    withTestDb(async ({ client }) => {
      const events = [
        { id: "1", foo: 1, event_type: "transfer" },
        { id: "2", foo: 4, event_type: "successful" },
        { id: "3", foo: 9, event_type: "transfer" },
        { id: "4", foo: 16, event_type: "transfer" },
        { id: "5", foo: 25, event_type: "transfer" },
      ];
      await opensea.addEvents({ client, events });
      await opensea.consumeEvents({ client, eventIds: ["1", "4"] });
      const retrieved = await opensea.getUnconsumedEvents({
        client,
        limit: 3,
        eventType: "transfer",
      });
      const expected = [events[2], events[4]].map((x) => ({
        eventId: x.id,
        json: x,
      }));
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
  it(
    "sales may be added and retrieved",
    withTestDb(async ({ client }) => {
      const tokenContract = "0xffffffffffffffffffffffffffffffffffffffff";
      const s1 = {
        eventId: "1",
        tokenContract,
        tokenId: "123",
        saleTime: new Date("2021-01-01"),
        price: "123456789",
        currencyContract: "0x0000000000000000000000000000000000000000",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      const s2 = {
        eventId: "2",
        tokenContract,
        tokenId: "456",
        saleTime: new Date("2021-01-01"),
        price: "123456789",
        currencyContract: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      const s3 = {
        eventId: "3",
        tokenContract,
        tokenId: "123",
        saleTime: new Date("2021-02-02"),
        price: "123456789",
        currencyContract: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      await opensea.addSales({ client, sales: [s1, s2, s3] });
      const retrieved = await opensea.salesForToken({
        client,
        tokenContract,
        tokenId: "123",
      });
      expect(retrieved).toEqual(
        [s1, s3].map((x) => ({ ...x, price: BigInt(x.price) }))
      );
    })
  );
  it(
    "currency contract 0x00...000 is converted to null",
    withTestDb(async ({ client }) => {
      const s1 = {
        eventId: "1",
        tokenContract: "0xffffffffffffffffffffffffffffffffffffffff",
        tokenId: "123",
        saleTime: new Date("2021-01-01"),
        price: "123456789",
        currencyContract: "0x0000000000000000000000000000000000000000",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      await opensea.addSales({ client, sales: [s1] });
      const result = await client.query(
        `SELECT currency_contract FROM opensea_sales`
      );
      expect(result.rows[0]).toEqual({ currency_contract: null });
    })
  );
});
