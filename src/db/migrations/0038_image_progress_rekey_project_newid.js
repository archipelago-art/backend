async function up({ client }) {
  await client.query(`
    ALTER TABLE image_progress
      DROP CONSTRAINT image_progress_pkey;
    ALTER TABLE image_progress ADD PRIMARY KEY (project_newid);
    ALTER TABLE image_progress ALTER COLUMN project_id DROP NOT NULL;
  `);
}

module.exports = { up };
