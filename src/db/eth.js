const ethers = require("ethers");

const log = require("../util/log")(__filename);

const orderbook = require("./orderbook");
const { bufToAddress, bufToHex, hexToBuf } = require("./util");
const ws = require("./ws");

async function getJobProgress({ client }) {
  const res = await client.query(
    `
    SELECT job_id AS "jobId", last_block_number AS "lastBlockNumber"
    FROM eth_job_progress
    ORDER BY job_id
    `
  );
  return res.rows;
}

async function addJob({ client, jobId, lastBlockNumber }) {
  await client.query(
    `
    INSERT INTO eth_job_progress (job_id, last_block_number)
    VALUES ($1, $2)
    `,
    [jobId, lastBlockNumber]
  );
}

async function updateJobProgress({ client, jobId, lastBlockNumber }) {
  const res = await client.query(
    `
    UPDATE eth_job_progress
    SET last_block_number = $2
    WHERE job_id = $1
    `,
    [jobId, lastBlockNumber]
  );
  return res.rowCount > 0;
}

/**
 * `blocks` should be an array of objects with:
 *
 *    hash: bytes32
 *    parentHash: bytes32
 *    number: uint256
 *    timestamp: uint256
 *
 * where each `bytes32` is represented as a 0x... string and each `uint256` can
 * be parsed with `BigNumber.from`.
 */
async function addBlocks({ client, blocks }) {
  const hashes = Array(blocks.length);
  const parentHashes = Array(blocks.length);
  const numbers = Array(blocks.length);
  const timestamps = Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    hashes[i] = hexToBuf(b.hash);
    parentHashes[i] = hexToBuf(b.parentHash);
    numbers[i] = ethers.BigNumber.from(b.number).toNumber();
    timestamps[i] = new Date(ethers.BigNumber.from(b.timestamp) * 1000);

    if (numbers[i] === 0) {
      // Check that parent is `bytes32(0)`.
      const actual = bufToHex(parentHashes[i]);
      const expected = ethers.constants.HashZero;
      if (actual !== expected) {
        throw new Error(
          `genesis block parent hash should be ${expected}, but is ${actual}`
        );
      }
      // Set parent hash to null so that it's not subject to foreign key
      // constraint (since the pregenesis "block" doesn't actually exist).
      parentHashes[i] = null;
    }
  }
  await client.query(
    `
    INSERT INTO eth_blocks (block_hash, parent_hash, block_number, block_timestamp)
    VALUES (unnest($1::bytes32[]), unnest($2::bytes32[]), unnest($3::int[]), unnest($4::timestamptz[]))
    ON CONFLICT (block_hash) DO NOTHING
    `,
    [hashes, parentHashes, numbers, timestamps]
  );
}

async function addBlock({ client, block }) {
  return await addBlocks({ client, blocks: [block] });
}

async function latestBlockHeader({ client }) {
  const res = await client.query(
    `
    SELECT
      block_hash AS "blockHash",
      parent_hash AS "parentHash",
      block_number AS "blockNumber",
      block_timestamp AS "blockTimestamp"
    FROM eth_blocks
    ORDER BY block_number DESC
    LIMIT 1
    `
  );
  const [row] = res.rows;
  if (row == null) return null;
  return {
    blockHash: bufToHex(row.blockHash),
    parentHash:
      row.parentHash == null
        ? ethers.constants.HashZero
        : bufToHex(row.parentHash),
    blockNumber: row.blockNumber,
    blockTimestamp: row.blockTimestamp,
  };
}

async function getBlockHeaders({ client, fromNumber, toNumber }) {
  const res = await client.query(
    `
    SELECT
      block_hash AS "blockHash",
      parent_hash AS "parentHash",
      block_number AS "blockNumber",
      block_timestamp AS "blockTimestamp"
    FROM eth_blocks
    WHERE block_number >= $1 AND block_number < $2
    ORDER BY block_number
    `,
    [fromNumber, toNumber]
  );
  return res.rows.map((r) => ({
    blockHash: bufToHex(r.blockHash),
    parentHash:
      r.parentHash == null ? ethers.constants.HashZero : bufToHex(r.parentHash),
    blockNumber: r.blockNumber,
    blockTimestamp: r.blockTimestamp,
  }));
}

async function blockExists({ client, blockHash }) {
  const res = await client.query(
    `
    SELECT 1 FROM eth_blocks WHERE block_hash = $1::bytes32
    `,
    [hexToBuf(blockHash)]
  );
  return res.rowCount > 0;
}

/**
 * Finds all blocks with height *at least* `blockNumberThreshold` and returns
 * their hashes and heights, in descending order (newest first).
 */
async function findBlockHeadersSince({ client, minBlockNumber }) {
  const res = await client.query(
    `
    SELECT block_hash AS "blockHash", block_number AS "blockNumber"
    FROM eth_blocks
    WHERE block_number >= $1
    ORDER BY block_number DESC
    `,
    [minBlockNumber]
  );
  return res.rows.map((r) => ({
    blockHash: bufToHex(r.blockHash),
    blockNumber: r.blockNumber,
  }));
}

async function deleteBlock({ client, blockHash }) {
  const res = await client.query(
    `
    DELETE FROM eth_blocks WHERE block_hash = $1::bytes32
    `,
    [hexToBuf(blockHash)]
  );
  return res.rowCount > 0;
}

async function addErc721Transfers({
  client,
  transfers,
  ignoreConflicts = false,
  alreadyInTransaction = false,
}) {
  const n = transfers.length;
  const tokenIds = Array(n);
  const fromAddresses = Array(n);
  const toAddresses = Array(n);
  const blockHashes = Array(n);
  const logIndices = Array(n);
  const transactionHashes = Array(n);
  for (let i = 0; i < transfers.length; i++) {
    const transfer = transfers[i];
    tokenIds[i] = transfer.tokenId;
    fromAddresses[i] = hexToBuf(transfer.fromAddress);
    toAddresses[i] = hexToBuf(transfer.toAddress);
    blockHashes[i] = hexToBuf(transfer.blockHash);
    logIndices[i] = transfer.logIndex;
    transactionHashes[i] = hexToBuf(transfer.transactionHash);
  }

  if (!alreadyInTransaction) await client.query("BEGIN");

  const conflictClause = ignoreConflicts ? "ON CONFLICT DO NOTHING" : "";

  const res = await client.query(
    `
    INSERT INTO erc721_transfers (
      token_id, from_address, to_address,
      block_hash, block_number, log_index,
      transaction_hash
    )
    SELECT
      i.token_id, i.from_address, i.to_address,
      i.block_hash, eth_blocks.block_number, i.log_index,
      i.transaction_hash
    FROM
      unnest($1::tokenid[], $2::address[], $3::address[], $4::bytes32[], $5::int[], $6::bytes32[])
        AS i(token_id, from_address, to_address, block_hash, log_index, transaction_hash)
      LEFT OUTER JOIN eth_blocks USING (block_hash)
    ${conflictClause}
    RETURNING (
      SELECT slug
      FROM tokens
      JOIN projects USING (project_id)
      WHERE token_id = erc721_transfers.token_id
    ) as slug,
    (
      SELECT token_index
      FROM tokens
      WHERE token_id = erc721_transfers.token_id
    ) as "tokenIndex",
    (
      SELECT block_timestamp
      FROM eth_blocks
      WHERE block_hash = erc721_transfers.block_hash
    ) as "blockTimestamp",
      token_id as "tokenId",
      from_address as "fromAddress",
      to_address as "toAddress",
      block_hash as "blockHash",
      block_number as "blockNumber",
      log_index as "logIndex",
      transaction_hash as "transactionHash"
    `,
    [
      tokenIds,
      fromAddresses,
      toAddresses,
      blockHashes,
      logIndices,
      transactionHashes,
    ]
  );

  const messages = res.rows.map((r) => ({
    type: "TOKEN_TRANSFERRED",
    topic: r.slug,
    data: {
      slug: r.slug,
      tokenIndex: r.tokenIndex,
      blockTimestamp: r.blockTimestamp.toISOString(),
      tokenId: r.tokenId,
      fromAddress: bufToAddress(r.fromAddress),
      toAddress: bufToAddress(r.toAddress),
      blockHash: bufToHex(r.blockHash),
      blockNumber: r.blockNumber,
      logIndex: r.logIndex,
      transactionHash: bufToHex(r.transactionHash),
    },
  }));
  await ws.sendMessages({ client, messages });

  if (!alreadyInTransaction) await client.query("COMMIT");
  return res.rowCount;
}

async function deleteErc721Transfers({ client, blockHash, tokenContract }) {
  const res = await client.query(
    `
    DELETE FROM erc721_transfers
    WHERE
      block_hash = $1::bytes32
      AND (
        SELECT token_contract FROM tokens t
        WHERE t.token_id = erc721_transfers.token_id
      ) = $2::address
    `,
    [hexToBuf(blockHash), hexToBuf(tokenContract)]
  );
  return res.rowCount;
}

async function getTransfersForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      block_number AS "blockNumber",
      log_index AS "logIndex",
      transaction_hash AS "transactionHash",
      block_hash AS "blockHash",
      (
        SELECT block_timestamp FROM eth_blocks
        WHERE eth_blocks.block_hash = erc721_transfers.block_hash
      ) AS "timestamp",
      from_address AS "from",
      to_address AS "to"
    FROM erc721_transfers
    WHERE token_id = $1
    ORDER BY block_number ASC, log_index ASC
    `,
    [tokenId]
  );
  return res.rows.map((r) => ({
    blockNumber: r.blockNumber,
    logIndex: r.logIndex,
    transactionHash: bufToHex(r.transactionHash),
    blockHash: bufToHex(r.blockHash),
    timestamp: r.timestamp,
    from: bufToAddress(r.from),
    to: bufToAddress(r.to),
  }));
}

async function getTransferCount({ client, fromAddress, toAddress }) {
  const res = await client.query(
    `
    SELECT count(1) AS "count" FROM erc721_transfers
    WHERE from_address = $1::address AND to_address = $2::address
    `,
    [hexToBuf(fromAddress), hexToBuf(toAddress)]
  );
  return Number(res.rows[0].count);
}

async function addNonceCancellations({
  client,
  marketContract,
  cancellations,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");

  const n = cancellations.length;
  const accounts = Array(n);
  const nonces = Array(n);
  const blockHashes = Array(n);
  const logIndices = Array(n);
  const transactionHashes = Array(n);
  for (let i = 0; i < cancellations.length; i++) {
    const cancellation = cancellations[i];
    accounts[i] = hexToBuf(cancellation.account);
    nonces[i] = String(cancellation.nonce);
    blockHashes[i] = hexToBuf(cancellation.blockHash);
    logIndices[i] = cancellation.logIndex;
    transactionHashes[i] = hexToBuf(cancellation.transactionHash);
  }
  const insertRes = await client.query(
    `
    INSERT INTO nonce_cancellations(
      market_contract, account, nonce,
      block_hash, block_number, log_index,
      transaction_hash
    )
    SELECT
      $1::address, i.account, i.nonce,
      i.block_hash, eth_blocks.block_number, i.log_index,
      i.transaction_hash
    FROM
      unnest($2::address[], $3::uint256[], $4::bytes32[], $5::int[], $6::bytes32[])
        AS i(account, nonce, block_hash, log_index, transaction_hash)
      LEFT OUTER JOIN eth_blocks USING (block_hash)
    ON CONFLICT (market_contract, account, nonce) DO NOTHING
    `,
    [
      hexToBuf(marketContract),
      accounts,
      nonces,
      blockHashes,
      logIndices,
      transactionHashes,
    ]
  );
  await orderbook.updateActivityForNonces({
    client,
    updates: cancellations.map((c) => ({
      account: c.account,
      nonce: c.nonce,
      active: false,
    })),
  });

  if (!alreadyInTransaction) await client.query("COMMIT");
  return insertRes.rowCount;
}

async function deleteNonceCancellations({
  client,
  blockHash,
  marketContract,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");

  const deleteRes = await client.query(
    `
    DELETE FROM nonce_cancellations
    WHERE block_hash = $1::bytes32 AND market_contract = $2::address
    RETURNING account, nonce
    `,
    [hexToBuf(blockHash), hexToBuf(marketContract)]
  );
  await orderbook.updateActivityForNonces({
    client,
    updates: deleteRes.rows.map((r) => ({
      account: bufToHex(r.account),
      nonce: r.nonce,
      active: true,
    })),
  });

  if (!alreadyInTransaction) await client.query("COMMIT");
  return deleteRes.rowCount;
}

module.exports = {
  getJobProgress,
  addJob,
  updateJobProgress,
  addBlock,
  addBlocks,
  getBlockHeaders,
  latestBlockHeader,
  blockExists,
  findBlockHeadersSince,
  deleteBlock,

  addErc721Transfers,
  deleteErc721Transfers,
  getTransfersForToken,
  getTransferCount,

  addNonceCancellations,
  deleteNonceCancellations,
};
