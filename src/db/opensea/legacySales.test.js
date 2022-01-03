const dbUtil = require("../util");
const opensea = require("./legacySales");
const { testDbProvider } = require("../testUtil");

describe("db/opensea", () => {
  const withTestDb = testDbProvider();
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
