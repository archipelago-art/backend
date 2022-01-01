async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members
      ALTER COLUMN trait_newid DROP NOT NULL;
    ALTER TABLE traits
      ALTER COLUMN trait_newid DROP NOT NULL,
      ALTER COLUMN feature_newid DROP NOT NULL;
    ALTER TABLE features
      ALTER COLUMN feature_newid DROP NOT NULL,
      ALTER COLUMN project_newid DROP NOT NULL;
  `);
}

module.exports = { up };
