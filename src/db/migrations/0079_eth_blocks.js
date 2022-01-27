async function up({ client }) {
  await client.query(
    `
    CREATE TABLE eth_blocks (
      block_hash bytes32 PRIMARY KEY,
      block_number int NOT NULL,
      timestamp timestamptz NOT NULL
    );
    `
  );
}

module.exports = { up };
