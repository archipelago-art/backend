const { ObjectType, newIds } = require("./id");
const { hexToBuf } = require("./util");
const ethers = require("ethers");
const log = require("../util/log")(__filename);

function logAddressToBuf(hexString) {
  const address = ethers.utils.hexDataSlice(hexString, 12);
  if (ethers.utils.hexZeroPad(address, 32) !== hexString) {
    throw new Error("logAddressToBuf: unexpected high bits set: " + hexString);
  }
  return hexToBuf(address);
}

/**
 * Adds ERC-721 transfer events. If this includes a transfer on contract
 * address `a` and block hash `h`, then *all* transfers with address `a` and
 * block hash `h` must either be in this input or already have been inserted
 * into the database.
 */
async function addTransfers({ client, transfers }) {
  await client.query("BEGIN");
  const insertsRes = await client.query(
    `
    INSERT INTO erc_721_transfers (
      token_id,
      transaction_hash,
      from_address,
      to_address,
      block_number,
      block_hash,
      log_index
    )
    SELECT
      tokens.token_id,
      inputs.transaction_hash,
      inputs.from_address,
      inputs.to_address,
      inputs.block_number,
      inputs.block_hash,
      inputs.log_index
    FROM unnest($1::text[], $2::address[], $3::address[], $4::int8[], $5::text[], $6::int[], $7::address[], $8::uint256[])
      AS inputs(transaction_hash, from_address, to_address, block_number, block_hash, log_index, token_contract, on_chain_token_id)
    JOIN tokens USING (token_contract, on_chain_token_id)
    RETURNING block_hash AS "blockHash", log_index AS "logIndex"
    `,
    [
      transfers.map((x) => x.transactionHash), // 1
      transfers.map((x) => logAddressToBuf(x.topics[1])), // 2: from address
      transfers.map((x) => logAddressToBuf(x.topics[2])), // 3: to address
      transfers.map((x) => x.blockNumber), // 4
      transfers.map((x) => x.blockHash), // 5
      transfers.map((x) => x.logIndex), // 6
      transfers.map((x) => hexToBuf(x.address)), // 7
      transfers.map((x) => String(ethers.BigNumber.from(x.topics[3]))), // 8: token ID
    ]
  );

  function blockHashIndexKey(blockHash, logIndex) {
    return `${blockHash}:${logIndex}`;
  }
  const missing = new Set(
    transfers.map((x) => blockHashIndexKey(x.blockHash, x.logIndex))
  );
  for (const row of insertsRes.rows) {
    missing.delete(blockHashIndexKey(row.blockHash, row.logIndex));
  }
  const missingTransfers = transfers.filter((x) =>
    missing.has(blockHashIndexKey(x.blockHash, x.logIndex))
  );
  await client.query(
    `
    INSERT INTO erc_721_transfers_deferred (token_contract, on_chain_token_id, log_object)
    VALUES (unnest($1::address[]), unnest($2::uint256[]), unnest($3::jsonb[]))
    `,
    [
      missingTransfers.map((x) => hexToBuf(x.address)),
      missingTransfers.map((x) => String(ethers.BigNumber.from(x.topics[3]))),
      missingTransfers.map((x) => JSON.stringify(x)),
    ]
  );

  await client.query(
    `
    INSERT INTO erc_721_transfer_scan_progress (
      contract_address,
      fetch_time,
      block_number,
      block_hash
    )
    SELECT DISTINCT contract_address, now(), block_number, block_hash
    FROM unnest($1::address[], $2::int8[], $3::text[])
      AS inputs(contract_address, block_number, block_hash)
    ON CONFLICT (contract_address, block_hash) DO UPDATE
      SET fetch_time = now()
    `,
    [
      transfers.map((x) => hexToBuf(x.address)),
      transfers.map((x) => x.blockNumber),
      transfers.map((x) => x.blockHash),
    ]
  );
  await client.query("COMMIT");
}

module.exports = {
  addTransfers,
};
