async function up({ client }) {
  await client.query(`
    ALTER TABLE image_progress
      ADD COLUMN project_newid projectid UNIQUE REFERENCES projects(project_newid),
      -- Highest token index "n" such that for all token indices "m <= n"
      -- within this project, we have images for "m". May be NULL if we have no
      -- images.
      ADD COLUMN completed_through_token_index integer;
  `);
}

module.exports = { up };
