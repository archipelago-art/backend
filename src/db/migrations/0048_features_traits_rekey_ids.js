async function up({ client }) {
  await client.query(`
    ALTER TABLE trait_members
      DROP CONSTRAINT trait_members_trait_newid_fkey,
      ALTER COLUMN trait_id TYPE traitid,
      ALTER COLUMN trait_id SET NOT NULL;
    ALTER TABLE traits
      DROP CONSTRAINT traits_feature_newid_fkey,
      ALTER COLUMN feature_id TYPE featureid,
      ALTER COLUMN feature_id SET NOT NULL,
      ALTER COLUMN trait_id TYPE traitid,
      DROP CONSTRAINT traits_pkey,
      ADD PRIMARY KEY (trait_id);
    ALTER TABLE features
      ALTER COLUMN project_id TYPE projectid,
      ALTER COLUMN feature_id TYPE featureid,
      DROP CONSTRAINT features_pkey,
      ADD PRIMARY KEY (feature_id);
    ALTER TABLE trait_members
      ADD FOREIGN KEY (trait_id) REFERENCES traits(trait_id);
  `);
}

module.exports = { up };
