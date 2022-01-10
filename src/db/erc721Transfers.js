const { ObjectType, newIds } = require("./id");
const { hexToBuf } = require("./util");
const ethers = require("ethers");
const log = require("../util/log")(__filename);

async function addTransfers({ client, transfers }) {
  await client.query(
    `
    INSERT INTO erc_721_transfers (
      token_id,
      transaction_hash,
      from,
      to,
      block_number,
      transaction_index,
      block_hash
    ) SELECT (
      token_id,
      unnest($1::text[]),
      hexaddr(unnest($2::text[])),
      hexaddr(unnest($3::text[])),
      unnest($4::int8[]),
      unnest($5::int[]),
      unnest($6::text[]),
    ) FROM tokens
    WHERE token_contract = hexaddr(unnest($7::text[]))
    AND on_chain_token_id = unnest($8::text[])
    `,
    [
      transfers.map((x) => x.transactionHash), // 1
      transfers.map((x) => x.topics[1]), // 2
      transfers.map((x) => x.topics[2]), // 3
      transfers.map((x) => x.blockNumber), // 4
      transfers.map((x) => x.transactionIndex), // 5
      transfers.map((x) => x.blockHash), // 6
      transfers.map((x) => x.address), // 7
      transfers.map((x) => ethers.BigNumber.from(x.topics[3])), // 8 -- the tokenId as hex string
    ]
  );
}
