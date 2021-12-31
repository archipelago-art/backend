async function up({ client }) {
  await client.query(`
    ALTER TABLE image_progress
      DROP COLUMN project_newid,
      DROP COLUMN completed_through_token_id;
  `);
}

module.exports = { up };
