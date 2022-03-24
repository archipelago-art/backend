async function up({ client }) {
  await client.query(
    `
    -- There's a legacy "eth_blocks" table, unfortunately.
    -- We'll consider renaming this to the good name after getting
    -- the system online and migrating.
    --
    -- Table only contains blocks currently in the canonical chain, and may
    -- contain only a sparse set of blocks.
    CREATE TABLE eth_blocks2 (
      block_hash bytes32 PRIMARY KEY,
      parent_hash bytes32 NOT NULL,
      block_number integer UNIQUE NOT NULL,
      block_timestamp timestamptz NOT NULL
    );

    CREATE INDEX eth_blocks2_block_number
      ON eth_blocks2(block_number DESC) INCLUDE (block_hash);

    CREATE TABLE eth_job_progress (
      job_id integer PRIMARY KEY,
      -- "block_number" of last-synced block. May be "-1" if the job has not
      -- synced to any block. May correspond to a block that is no longer
      -- canonical.
      last_block_number integer NOT NULL
    );
    `
  );
}

module.exports = { up };
