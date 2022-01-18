async function up({ client }) {
  await client.query(`
    ALTER TABLE opensea_progress
      ADD COLUMN project_id projectid REFERENCES projects(project_id)
  `);
}

module.exports = { up };
