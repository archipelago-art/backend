async function up({ client }) {
  await client.query(`
    BEGIN;
    ALTER TABLE projects ALTER COLUMN project_newid SET NOT NULL;
    ALTER TABLE tokens
      ALTER COLUMN token_newid SET NOT NULL,
      ALTER COLUMN project_newid SET NOT NULL;
    ALTER TABLE features
      ALTER COLUMN feature_newid SET NOT NULL,
      ALTER COLUMN project_newid SET NOT NULL;
    ALTER TABLE traits
      ALTER COLUMN trait_newid SET NOT NULL,
      ALTER COLUMN feature_newid SET NOT NULL;
    ALTER TABLE trait_members
      ALTER COLUMN trait_newid SET NOT NULL,
      ALTER COLUMN token_newid SET NOT NULL;
    COMMIT;
  `);
}

module.exports = { up };
