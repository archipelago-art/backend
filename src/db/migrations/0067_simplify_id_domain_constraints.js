async function up({ client }) {
  await client.query(`
    ALTER DOMAIN tokenid ADD CONSTRAINT tokenid_type
      CHECK ((VALUE >> 58) & 63 = 1);
    ALTER DOMAIN projectid ADD CONSTRAINT projectid_type
      CHECK ((VALUE >> 58) & 63 = 2);
    ALTER DOMAIN featureid ADD CONSTRAINT featureid_type
      CHECK ((VALUE >> 58) & 63 = 3);
    ALTER DOMAIN traitid ADD CONSTRAINT traitid_type
      CHECK ((VALUE >> 58) & 63 = 4);
    ALTER DOMAIN currencyid ADD CONSTRAINT currencyid_type
      CHECK ((VALUE >> 58) & 63 = 5);

    ALTER DOMAIN tokenid DROP CONSTRAINT tokenid_range;
    ALTER DOMAIN projectid DROP CONSTRAINT projectid_range;
    ALTER DOMAIN featureid DROP CONSTRAINT featureid_range;
    ALTER DOMAIN traitid DROP CONSTRAINT traitid_range;
    -- (this next constraint name was misspelled when added)
    ALTER DOMAIN currencyid DROP CONSTRAINT tokenid_range;
  `);
}

module.exports = { up };
