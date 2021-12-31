async function up({ client }) {
  // This widens from `int4` to `int8`, and is safe for clients because the
  // values of this column are not used.
  await client.query(`
    ALTER TABLE image_progress
      ALTER COLUMN project_id TYPE int8;
  `);
}

module.exports = { up };
