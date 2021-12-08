async function up({ client }) {
  await client.query(`
    ALTER TABLE backfill_state_trait_members RENAME TO deprecated_backfill_state_trait_members;
  `);
}

async function down({ client }) {
  await client.query(`
    ALTER TABLE deprecated_backfill_state_trait_members RENAME TO backfill_state_trait_members;
  `);
}

module.exports = { up, down };
