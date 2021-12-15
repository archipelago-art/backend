async function up({ client }) {
  // Computed from `src/db/id.js`'s `idBounds`, but inlined here so that the
  // migration script is self-contained and not fragile.
  const bounds = {
    TOKEN: { min: 0x400000000000000n, max: 0x7ffffffffffffffn },
    PROJECT: { min: 0x800000000000000n, max: 0xbffffffffffffffn },
    FEATURE: { min: 0xc00000000000000n, max: 0xfffffffffffffffn },
    TRAIT: { min: 0x1000000000000000n, max: 0x13ffffffffffffffn },
  };
  await client.query(`
    BEGIN;
    CREATE DOMAIN tokenid AS int8 CONSTRAINT tokenid_range CHECK(
      VALUE >= ${bounds.TOKEN.min} AND VALUE <= ${bounds.TOKEN.max}
    );
    CREATE DOMAIN projectid AS int8 CONSTRAINT projectid_range CHECK(
      VALUE >= ${bounds.PROJECT.min} AND VALUE <= ${bounds.PROJECT.max}
    );
    CREATE DOMAIN featureid AS int8 CONSTRAINT featureid_range CHECK(
      VALUE >= ${bounds.FEATURE.min} AND VALUE <= ${bounds.FEATURE.max}
    );
    CREATE DOMAIN traitid AS int8 CONSTRAINT traitid_range CHECK(
      VALUE >= ${bounds.TRAIT.min} AND VALUE <= ${bounds.TRAIT.max}
    );
    ALTER TABLE projects ADD COLUMN project_newid projectid UNIQUE;
    ALTER TABLE tokens
      ADD COLUMN token_newid tokenid UNIQUE,
      ADD COLUMN project_newid projectid REFERENCES projects(project_newid);
    ALTER TABLE features
      ADD COLUMN feature_newid featureid UNIQUE,
      ADD COLUMN project_newid projectid REFERENCES projects(project_newid);
    ALTER TABLE traits
      ADD COLUMN trait_newid traitid UNIQUE,
      ADD COLUMN feature_newid featureid REFERENCES features(feature_newid);
    ALTER TABLE trait_members
      ADD COLUMN trait_newid traitid REFERENCES traits(trait_newid),
      ADD COLUMN token_newid tokenid REFERENCES tokens(token_newid),
      ADD UNIQUE(trait_newid, token_newid);
    COMMIT;
  `);
}

module.exports = { up };
