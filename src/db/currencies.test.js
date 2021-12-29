const { currencies } = require("./wellKnownCurrencies");
const dbUtil = require("./util");
const { testDbProvider } = require("./testUtil");

describe("db/currencies", () => {
  const withTestDb = testDbProvider();

  async function getCurrency(client, id) {
    const res = await client.query(
      `
      SELECT currency_id AS "currencyId", address, symbol, name, decimals
      FROM currencies
      WHERE currency_id=$1
      `,
      [id]
    );
    if (res.rows.length === 0) {
      return null;
    }
    const x = res.rows[0];
    return { ...x, address: dbUtil.bufToAddress(x.address) };
  }

  it(
    "contains well known currencies with expected ids",
    withTestDb(async ({ client }) => {
      for (const currency of currencies) {
        expect(await getCurrency(client, currency.currencyId)).toEqual(
          currency
        );
      }
    })
  );
});
