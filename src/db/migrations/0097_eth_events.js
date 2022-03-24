async function up({ client }) {
  await client.query(
    `
    -- There's a legacy "eth_blocks" table, unfortunately.
    -- We'll consider renaming this to the good name after getting
    -- the system online and migrating.
    --
    -- Table only contains blocks currently in the canonical chain.
    --
    -- Contains a pseudo-block with null hash and parent, to serve as the
    -- parent of the genesis block.
    CREATE TABLE eth_blocks2 (
      block_hash bytes32 PRIMARY KEY,
      parent_hash bytes32 NOT NULL,  -- REFERENCES eth_blocks2(block_hash),
      block_number integer UNIQUE NOT NULL,
      block_timestamp timestamptz NOT NULL
    );

    CREATE INDEX eth_blocks2_block_number
      ON eth_blocks2(block_number DESC) INCLUDE (block_hash);

    CREATE TABLE eth_events (
      block_hash bytes32 NOT NULL REFERENCES eth_blocks2(block_hash),
      log_index integer NOT NULL,
      PRIMARY KEY(block_hash, log_index),
      tx_hash bytes32 NOT NULL,
      contract_address address NOT NULL,
      topics uint256[] NOT NULL,
      data bytea NOT NULL
    );
    `
  );
}

module.exports = { up };
