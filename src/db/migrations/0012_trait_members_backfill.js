async function up({ client }) {
  await client.query(`
    CREATE TABLE backfill_state_trait_members (
      token_id integer PRIMARY KEY REFERENCES tokens(token_id)
    );
  `);
}

module.exports = { up };
