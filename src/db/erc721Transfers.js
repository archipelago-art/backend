const { ObjectType, newIds } = require("./id");
const { hexToBuf, bufToAddress } = require("./util");
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
  const res = await addTransfersNontransactionally({ client, transfers });
  await client.query("COMMIT");
  return res;
}

async function addTransfersNontransactionally({ client, transfers }) {
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
  return { inserted: insertsRes.rowCount, deferred: missingTransfers.length };
}

async function undeferTransfers({ client }) {
  await client.query("BEGIN");
  const readyRes = await client.query(
    `
    SELECT log_object AS transfer
    FROM erc_721_transfers_deferred JOIN tokens USING (token_contract, on_chain_token_id)
    `
  );
  const transfers = readyRes.rows.map((row) => row.transfer);
  await addTransfersNontransactionally({ client, transfers });
  const deleteRes = await client.query(
    `
    DELETE FROM erc_721_transfers_deferred AS t
    USING unnest($1::address[], $2::uint256[], $3::text[], $4::text[])
      AS d(token_contract, on_chain_token_id, block_hash, log_index)
    WHERE
      t.token_contract = d.token_contract
      AND t.on_chain_token_id = d.on_chain_token_id
      AND t.log_object->>'blockHash' = d.block_hash
      AND t.log_object->>'logIndex' = d.log_index
    `,
    [
      transfers.map((x) => hexToBuf(x.address)),
      transfers.map((x) => String(ethers.BigNumber.from(x.topics[3]))),
      transfers.map((x) => x.blockHash),
      transfers.map((x) => String(x.logIndex)),
    ]
  );
  if (deleteRes.rowCount !== transfers.length) {
    throw new Error(
      `expected to delete ${transfers.length} deferral records, ` +
        `but deleted ${deleteRes.rowCount}`
    );
  }
  await client.query("COMMIT");
  return transfers.length;
}

async function getLastBlockNumber({ client, contractAddress }) {
  const res = await client.query(
    `
    SELECT max(block_number) AS "max" FROM erc_721_transfer_scan_progress
    WHERE contract_address = $1::address
    `,
    [hexToBuf(contractAddress)]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].max;
}

async function getTransfersForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      block_number AS "blockNumber",
      log_index AS "logIndex",
      transaction_hash AS "transactionHash",
      block_hash AS "blockHash",
      from_address AS "from",
      to_address AS "to"
    FROM erc_721_transfers
    WHERE token_id = $1
    ORDER BY block_number ASC, log_index ASC
    `,
    [tokenId]
  );
  return res.rows.map((r) => ({
    blockNumber: r.blockNumber,
    logIndex: r.logIndex,
    transactionHash: r.transactionHash,
    blockHash: r.blockHash,
    from: bufToAddress(r.from),
    to: bufToAddress(r.to),
  }));
}

module.exports = {
  addTransfers,
  getLastBlockNumber,
  getTransfersForToken,
  undeferTransfers,
};
