async function up({ client }) {
  await client.query("BEGIN");
  await client.query(`
    CREATE DOMAIN uint256 AS numeric(78, 0)
      CONSTRAINT uint256_nonnegative CHECK(VALUE >= 0)
      CONSTRAINT uint256_range CHECK(VALUE < 115792089237316195423570985008687907853269984665640564039457584007913129639936)
      ;
  `);
  await client.query(`
    CREATE DOMAIN address AS bytea
      CONSTRAINT address_length CHECK(octet_length(VALUE) = 20)
      ;
  `);
  await client.query("COMMIT");
}

module.exports = { up };
