async function up({ client }) {
  await client.query(`
    CREATE TABLE token_rarity (
      token_id tokenid PRIMARY KEY REFERENCES tokens(token_id), 
      rarity_rank integer, 
      last_modified timestamptz NOT NULL
    );
  `);
}
// TODO turn into separate table and store last refresh time
module.exports = { up };
