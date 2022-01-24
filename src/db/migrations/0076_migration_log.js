async function up({ client }) {
  await client.query(
    `
    CREATE TABLE migration_log (
      -- Randomly generated primary key, just for unique addressing.
      migration_id int8 PRIMARY KEY,
      -- Name of the migration, like "0076_migration_log".
      name text NOT NULL,
      timestamp timestamptz NOT NULL,
      -- Value of "git hash-object -t blob MIGRATION_FILE" (using SHA-1) at the
      -- time that the migration was run.
      blob_hash bytea NOT NULL,
      CHECK(octet_length(blob_hash) = 20)
    );
    `
  );
}

module.exports = { up };
