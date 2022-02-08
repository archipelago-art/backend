async function up({ client }) {
  await client.query(`
    CREATE DOMAIN signature AS bytea
      CONSTRAINT signature_length CHECK(octet_length(VALUE) = 65)
      ;
  `);
}

module.exports = { up };
