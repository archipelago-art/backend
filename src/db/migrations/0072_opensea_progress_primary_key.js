async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_progress
      DROP CONSTRAINT opensea_progress_pkey;
    ALTER TABLE opensea_progress ADD PRIMARY KEY (project_id);
  `);
}

module.exports = { up };
