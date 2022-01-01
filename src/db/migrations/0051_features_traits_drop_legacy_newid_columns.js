async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members DROP COLUMN deprecated_trait_newid;
    ALTER TABLE traits DROP COLUMN deprecated_trait_newid;
    ALTER TABLE traits DROP COLUMN deprecated_feature_newid;
    ALTER TABLE features DROP COLUMN deprecated_feature_newid;
    ALTER TABLE features DROP COLUMN deprecated_project_newid;
  `);
}

module.exports = { up };
