async function up({ client }) {
  await client.query(`
    ALTER TABLE image_progress
      ADD FOREIGN KEY (project_id) REFERENCES projects(project_newid);
  `);
}

module.exports = { up };
