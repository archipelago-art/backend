async function up({ client }) {
  await client.query(
    `
    -- Table only contains blocks currently in the canonical chain, and is
    -- meant to contain all historical blocks.
    CREATE TABLE eth_blocks (
      block_hash bytes32 PRIMARY KEY,
      parent_hash bytes32 NOT NULL,
      block_number integer UNIQUE NOT NULL,
      block_timestamp timestamptz NOT NULL
    );

    CREATE INDEX eth_blocks_block_number
      ON eth_blocks(block_number DESC) INCLUDE (block_hash);

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
