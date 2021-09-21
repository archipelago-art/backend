async function up({ client }) {
  await client.query(`
    ALTER TABLE projects
      ALTER COLUMN name SET NOT NULL,
      ALTER COLUMN max_invocations SET NOT NULL;
  `);
}

module.exports = { up };
