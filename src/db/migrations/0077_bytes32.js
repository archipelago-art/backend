async function up({ client }) {
  await client.query(`
    CREATE DOMAIN bytes32 AS bytea
      CONSTRAINT bytes32_length CHECK(octet_length(VALUE) = 32)
      ;
  `);
}

module.exports = { up };
