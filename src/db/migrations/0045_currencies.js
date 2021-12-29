// Duplicated with src/db/wellKnownCurrencies
const eth = {
  currencyId: "1535410341709086720",
  address: "0x0000000000000000000000000000000000000000",
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};
const weth9 = {
  currencyId: "1540312924849438721",
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
};
const usdc = {
  currencyId: "1541639835452702722",
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};
const dai = {
  currencyId: "1544284093318430723",
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  symbol: "DAI",
  name: "Dai Stablecoin",
  decimals: 18,
};

const currencies = [eth, weth9, usdc, dai];

async function up({ client }) {
  const bounds = { min: 0x1400000000000000n, max: 0x17ffffffffffffffn };
  await client.query(
    `
    BEGIN;
    CREATE DOMAIN currencyid AS int8 CONSTRAINT tokenid_range CHECK(
      VALUE >= ${bounds.min} AND VALUE <= ${bounds.max}
    );
    CREATE TABLE currencies (
      currency_id currencyid PRIMARY KEY,
      address address UNIQUE NOT NULL,
      symbol text NOT NULL,
      name text NOT NULL,
      decimals integer
    );
    `
  );
  await client.query(
    `
    INSERT INTO currencies (
      currency_id,
      address,
      symbol,
      name,
      decimals
    ) VALUES (
      unnest($1::currencyid[]),
      hexaddr(unnest($2::text[])),
      unnest($3::text[]),
      unnest($4::text[]),
      unnest($5::integer[])
    );
    `,
    [
      currencies.map((x) => x.currencyId),
      currencies.map((x) => x.address),
      currencies.map((x) => x.symbol),
      currencies.map((x) => x.name),
      currencies.map((x) => x.decimals),
    ]
  );
  await client.query("COMMIT");
}

module.exports = { up };
