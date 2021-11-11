async function up({ client }) {
  await client.query(`
    CREATE TABLE image_progress (
      project_id integer PRIMARY KEY REFERENCES projects(project_id),
      -- Highest token ID "n" such that for all token IDs "m <= n" within this
      -- project, we have images for "m". May be NULL if we have no images.
      completed_through_token_id integer
    );
  `);
}

module.exports = { up };
