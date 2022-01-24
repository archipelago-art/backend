async function up({ client }) {
  await client.query(
    `
    CREATE DOMAIN bidid AS int8 CONSTRAINT bidid_type
      CHECK ((VALUE >> 58) & 63 = 6);
    CREATE DOMAIN askid AS int8 CONSTRAINT askid_type
      CHECK ((VALUE >> 58) & 63 = 7);
    `
  );
  await client.query("COMMIT");
}

module.exports = { up };
