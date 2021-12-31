async function up({ client }) {
  await client.query(`
    ALTER TABLE image_progress DROP CONSTRAINT image_progress_project_id_fkey;
  `);
}

module.exports = { up };
