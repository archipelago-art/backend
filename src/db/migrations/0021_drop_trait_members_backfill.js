async function up({ client }) {
  await client.query(`
    DROP TABLE deprecated_backfill_state_trait_members;
  `);
}

module.exports = { up };
