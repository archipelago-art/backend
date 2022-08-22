async function up({ client }) {
  await client.query(`
    CREATE TABLE token_rarity (
      token_id tokenid PRIMARY KEY REFERENCES tokens(token_id),
      project_id projectid NOT NULL REFERENCES projects(project_id),
      rarity_rank integer,
      update_time timestamptz NOT NULL
    );
    CREATE INDEX token_rarity_project_id_rarity_rank
    ON token_rarity (project_id, rarity_rank);
  `);
}
module.exports = { up };
