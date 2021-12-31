async function up({ client }) {
  // This restricts from `int8` to `projectid`, a domain of `int8` with
  // equivalent input/output representations.
  await client.query(`
    ALTER TABLE image_progress
      ALTER COLUMN project_id TYPE projectid;
  `);
}

module.exports = { up };
