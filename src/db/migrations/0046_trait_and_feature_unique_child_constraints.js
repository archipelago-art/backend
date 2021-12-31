async function up({ client }) {
  await client.query(`
    ALTER TABLE features
      ADD UNIQUE (project_newid, name);
    ALTER TABLE traits
      ADD UNIQUE (feature_newid, value);
  `);
}

module.exports = { up };
