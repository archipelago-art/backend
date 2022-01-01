async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members
      DROP CONSTRAINT trait_members_trait_id_fkey,
      ALTER COLUMN trait_id TYPE int8;  -- will eventually be "traitid"
    ALTER TABLE traits
      DROP CONSTRAINT traits_feature_id_fkey,
      ALTER COLUMN feature_id TYPE int8,  -- will eventually be "featureid"
      ALTER COLUMN feature_id DROP NOT NULL,
      ALTER COLUMN trait_id TYPE int8,  -- will eventually be "traitid"
      DROP CONSTRAINT traits_pkey,
      ADD PRIMARY KEY (trait_newid),
      ALTER COLUMN trait_id DROP NOT NULL,
      ALTER COLUMN trait_id DROP DEFAULT;
    ALTER TABLE features
      ALTER COLUMN project_id TYPE int8,  -- will eventually be "projectid"
      ALTER COLUMN project_id DROP NOT NULL,
      ALTER COLUMN feature_id DROP DEFAULT,
      ALTER COLUMN feature_id TYPE int8,  -- will eventually be "featureid"
      DROP CONSTRAINT features_pkey,
      ADD PRIMARY KEY (feature_newid),
      ALTER COLUMN feature_id DROP NOT NULL,
      ALTER COLUMN feature_id DROP DEFAULT;
  `);
}

module.exports = { up };
