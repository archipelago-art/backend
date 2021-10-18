async function up({ client }) {
  // Aspect ratio can be derived from `script_json->'aspectRatio'`, but
  // that's (a) weakly typed (could just be missing) and (b) of wildly
  // varying input format.
  await client.query(`
    ALTER TABLE projects
      ADD COLUMN aspect_ratio float8;
  `);
}

module.exports = { up };
