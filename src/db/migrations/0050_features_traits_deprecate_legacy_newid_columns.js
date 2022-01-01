async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members RENAME COLUMN trait_newid TO deprecated_trait_newid;
    ALTER TABLE traits RENAME COLUMN trait_newid TO deprecated_trait_newid;
    ALTER TABLE traits RENAME COLUMN feature_newid TO deprecated_feature_newid;
    ALTER TABLE features RENAME COLUMN feature_newid TO deprecated_feature_newid;
    ALTER TABLE features RENAME COLUMN project_newid TO deprecated_project_newid;
  `);
}

module.exports = { up };
