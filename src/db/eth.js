const ethers = require("ethers");

const log = require("../util/log")(__filename);

const Cmp = require("../util/cmp");
const { ObjectType, newIds } = require("./id");
const orderbook = require("./orderbook");
const { bufToAddress, bufToHex, hexToBuf } = require("./util");
const wellKnownCurrencies = require("./wellKnownCurrencies");
const ws = require("./ws");

async function getJobs({ client }) {
  const res = await client.query(
    `
    SELECT
      job_id AS "jobId",
      last_block_number AS "lastBlockNumber",
      job_type AS "type",
      job_args AS "args"
    FROM eth_job_progress
    ORDER BY job_id
    `
  );
  return res.rows;
}

async function addJob({ client, jobId, lastBlockNumber, type, args }) {
  await client.query(
    `
    INSERT INTO eth_job_progress (job_id, last_block_number, job_type, job_args)
    VALUES ($1, $2, $3, $4)
    `,
    [jobId, lastBlockNumber, type, JSON.stringify(args)]
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

async function updateJobSpec({ client, jobId, type, args }) {
  const res = await client.query(
    `
    UPDATE eth_job_progress
    SET job_type = $2, job_args = $3
    WHERE job_id = $1
    `,
    [jobId, type, JSON.stringify(args)]
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
  res.rows.sort(
    Cmp.first([
      Cmp.comparing((x) => x.blockNumber),
      Cmp.comparing((x) => x.logIndex),
    ])
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

  await orderbook.updateActivityForTokenOwners({
    client,
    updates: res.rows.map((t) => ({
      tokenId: t.tokenId,
      newOwner: bufToHex(t.toAddress),
    })),
  });

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
    RETURNING
      token_id as "tokenId",
      from_address as "fromAddress",
      block_number AS "blockNumber",
      log_index AS "logIndex"
    `,
    [hexToBuf(blockHash), hexToBuf(tokenContract)]
  );
  res.rows.sort(
    Cmp.rev(
      Cmp.first([
        Cmp.comparing((x) => x.blockNumber),
        Cmp.comparing((x) => x.logIndex),
      ])
    )
  );
  await orderbook.updateActivityForTokenOwners({
    client,
    updates: res.rows.map((t) => ({
      tokenId: t.tokenId,
      // Rolling back a transfer from Alice to Bob means that Alice---the
      // "from" address---is now the owner again.
      newOwner: bufToHex(t.fromAddress),
    })),
  });
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

async function addFills({
  client,
  marketContract,
  fills,
  alreadyInTransaction = false,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");

  const currencyAddresses = fills.map((f) => f.currency);
  const currencyIds = await getCurrencyIds(client, currencyAddresses);

  // The `LEFT OUTER JOIN` on `tokens` may produce a `NULL` `token_id` if we
  // don't know about the token; this is okay. The `LEFT OUTER JOIN` on
  // `eth_blocks` will cause the insert to fail if any of the block hashes is
  // not known, because `log_index` has a `NOT NULL` constraint.
  const res = await client.query(
    `
    INSERT INTO fills (
      market_contract, trade_id,
      token_id, project_id, token_contract, on_chain_token_id,
      buyer, seller,
      currency_id, price, proceeds, cost,
      block_hash, block_number, log_index, transaction_hash
    )
    SELECT
      $1::address, i.trade_id,
      t.token_id, t.project_id, i.token_contract, i.on_chain_token_id,
      i.buyer, i.seller,
      i.currency_id, i.price, i.proceeds, i.cost,
      i.block_hash, b.block_number, i.log_index, i.transaction_hash
    FROM
      unnest(
        $2::bytes32[],
        $3::address[], $4::uint256[], $5::address[], $6::address[],
        $7::currencyid[], $8::uint256[], $9::uint256[], $10::uint256[],
        $11::bytes32[], $12::int[], $13::bytes32[]
      ) AS i(
        trade_id,
        token_contract, on_chain_token_id, buyer, seller,
        currency_id, price, proceeds, cost,
        block_hash, log_index, transaction_hash
      )
      LEFT OUTER JOIN tokens t USING (token_contract, on_chain_token_id)
      LEFT OUTER JOIN eth_blocks b ON i.block_hash = b.block_hash
    RETURNING
      trade_id AS "tradeId",
      token_id AS "tokenId",
      (
        SELECT slug FROM projects p
        WHERE p.project_id = fills.project_id
      ) AS "slug",
      (
        SELECT token_index FROM tokens t
        WHERE t.token_id = fills.token_id
      ) AS "tokenIndex",
      (
        SELECT block_timestamp FROM eth_blocks b
        WHERE b.block_hash = fills.block_hash
      ) AS "blockTimestamp",
      block_number AS "blockNumber"
    `,
    [
      hexToBuf(marketContract),
      fills.map((f) => hexToBuf(f.tradeId)),
      //
      fills.map((f) => hexToBuf(f.tokenContract)),
      fills.map((f) => String(f.onChainTokenId)),
      fills.map((f) => hexToBuf(f.buyer)),
      fills.map((f) => hexToBuf(f.seller)),
      //
      currencyIds,
      fills.map((f) => String(f.price)),
      fills.map((f) => String(f.proceeds)),
      fills.map((f) => String(f.cost)),
      //
      fills.map((f) => hexToBuf(f.blockHash)),
      fills.map((f) => f.logIndex),
      fills.map((f) => hexToBuf(f.transactionHash)),
    ]
  );

  const byTradeId = new Map(fills.map((f) => [f.tradeId, f]));
  const messages = res.rows
    .map((r) => {
      if (r.tokenId == null) return null;
      const tradeId = bufToHex(r.tradeId);
      const fill = byTradeId.get(tradeId);
      return {
        type: "TOKEN_TRADED",
        topic: r.slug,
        data: {
          tradeId,
          slug: r.slug,
          tokenIndex: r.tokenIndex,
          tokenId: r.tokenId,
          buyer: ethers.utils.getAddress(fill.buyer),
          seller: ethers.utils.getAddress(fill.seller),
          currency: ethers.utils.getAddress(fill.currency),
          price: String(fill.price),
          proceeds: String(fill.proceeds),
          cost: String(fill.cost),
          blockHash: fill.blockHash,
          blockNumber: r.blockNumber,
          logIndex: fill.logIndex,
          transactionHash: fill.transactionHash,
          blockTimestamp: r.blockTimestamp.toISOString(),
        },
      };
    })
    .filter(Boolean);
  await ws.sendMessages({ client, messages });

  if (!alreadyInTransaction) await client.query("COMMIT");
}

async function getCurrencyIds(client, currencyAddresses) {
  currencyAddresses = currencyAddresses.map((a) => ethers.utils.getAddress(a));
  const existingRes = await client.query(
    `
    SELECT DISTINCT currency_id AS "currencyId", address
    FROM currencies
    WHERE address = ANY($1::address[])
    `,
    [currencyAddresses.map(hexToBuf)]
  );
  const addressToId = new Map();
  for (const { currencyId, address } of existingRes.rows) {
    addressToId.set(bufToAddress(address), currencyId);
  }
  const newAddressesSet = new Set();
  const result = Array(currencyAddresses.length);
  for (let i = 0; i < result.length; i++) {
    const address = currencyAddresses[i];
    const id = addressToId.get(address);
    result[i] = id;
    if (id == null) {
      newAddressesSet.add(address);
    }
  }
  if (newAddressesSet.size === 0) return result;
  const newAddresses = Array.from(newAddressesSet);
  const currencyIds = newIds(newAddresses.length, ObjectType.CURRENCY);
  for (let i = 0; i < newAddresses.length; i++) {
    addressToId.set(newAddresses[i], currencyIds[i]);
  }
  await client.query(
    `
    INSERT INTO currencies (
      currency_id,
      address,
      symbol,
      name,
      decimals
    ) VALUES (unnest($1::currencyid[]), unnest($2::address[]), '', '', 0)
    `,
    [currencyIds, newAddresses.map(hexToBuf)]
  );
  for (let i = 0; i < result.length; i++) {
    if (result[i] == null) result[i] = addressToId.get(currencyAddresses[i]);
  }
  return result;
}

async function deleteFills({ client, marketContract, blockHash }) {
  const deleteRes = await client.query(
    `
    DELETE FROM fills
    WHERE block_hash = $1::bytes32 AND market_contract = $2::address
    `,
    [hexToBuf(blockHash), hexToBuf(marketContract)]
  );
  return deleteRes.rowCount;
}

async function fillsByToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT
      seller AS "from",
      buyer AS "to",
      block_timestamp AS "timestamp",
      transaction_hash AS "transactionHash",
      price AS "priceWei"
    FROM fills JOIN eth_blocks USING (block_hash)
    WHERE token_id = $1::tokenid AND currency_id IN ($2, $3)
    ORDER BY fills.block_number, fills.log_index
    `,
    [
      tokenId,
      wellKnownCurrencies.eth.currencyId,
      wellKnownCurrencies.weth9.currencyId,
    ]
  );
  return res.rows.map((r) => ({
    from: bufToAddress(r.from),
    to: bufToAddress(r.to),
    timestamp: r.timestamp,
    transactionHash: bufToHex(r.transactionHash),
    priceWei: r.priceWei,
  }));
}

/**
 * Get the most recent sale (timestamp and price) for each token in the
 * project. Sales not in ETH/WETH are ignored. Tokens with no ETH/WETH sales
 * are omitted from the output.
 */
async function lastFillsByProject({ client, projectId }) {
  const res = await client.query(
    `
    SELECT DISTINCT ON (token_id)
      token_id AS "tokenId",
      block_timestamp AS "saleTime",
      price AS "priceWei"
    FROM fills JOIN eth_blocks USING (block_hash)
    WHERE
      project_id = $1::projectid
      AND currency_id IN ($2::currencyid, $3::currencyid)
    ORDER BY token_id, fills.block_number DESC, fills.log_index DESC
    `,
    [
      projectId,
      wellKnownCurrencies.eth.currencyId,
      wellKnownCurrencies.weth9.currencyId,
    ]
  );
  return res.rows;
}

async function addErc20Deltas({
  client,
  currencyId,
  deltas /*: Array<{ account: address, blockHash: bytes32, delta: BigNumberish }> */:
    inputs,
  skipActivityUpdates = false,
  alreadyInTransaction = true,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");

  // keys: block hashes, as lowercase `bytes32` strings
  // values: `Map<LowercaseAddress, BigNumber>`s representing total deltas
  const blockToDeltas = new Map();
  // keys: accounts as lowercase addresses
  // values: objects with
  //    - `delta`: `BigNumber` representing total delta across all blocks
  //    - `minDelta`: most negative cumulative value of `delta` at any point
  //    - `maxDelta`: m.m.
  const accountUpdates = new Map();

  function updateSum(map, account, delta) {
    const existing = map.get(account) || ethers.constants.Zero;
    map.set(account, existing.add(delta));
  }
  for (const input of inputs) {
    const blockHash = input.blockHash.toLowerCase();
    const account = input.account.toLowerCase();
    const delta = ethers.BigNumber.from(input.delta);
    let blockDeltas = blockToDeltas.get(blockHash);
    if (blockDeltas == null)
      blockToDeltas.set(blockHash, (blockDeltas = new Map()));
    updateSum(blockDeltas, account, delta);

    let accountUpdate = accountUpdates.get(account);
    if (accountUpdate == null) {
      accountUpdate = {
        delta: ethers.constants.Zero,
        minDelta: ethers.constants.Zero,
        maxDelta: ethers.constants.Zero,
      };
      accountUpdates.set(account, accountUpdate);
    }
    accountUpdate.delta = accountUpdate.delta.add(delta);
    if (accountUpdate.delta.lt(accountUpdate.minDelta))
      accountUpdate.minDelta = accountUpdate.delta;
    if (accountUpdate.delta.gt(accountUpdate.maxDelta))
      accountUpdate.maxDelta = accountUpdate.delta;
  }

  const blockHashes = [];
  const accounts = [];
  const deltas = [];
  for (const [block, totalDeltas] of blockToDeltas) {
    for (const [account, totalDelta] of totalDeltas) {
      if (totalDelta.isZero()) continue;
      blockHashes.push(hexToBuf(block));
      accounts.push(hexToBuf(account));
      deltas.push(String(totalDelta));
    }
  }
  await client.query(
    `
    INSERT INTO erc20_deltas (currency_id, account, block_hash, delta)
    VALUES (
      $1::currencyid,
      unnest($2::address[]),
      unnest($3::bytes32[]),
      unnest($4::numeric(78, 0)[])
    )
    `,
    [currencyId, accounts, blockHashes, deltas]
  );

  const insertRes = await client.query(
    `
    WITH new_balances AS (
      SELECT account, (coalesce(balance, 0)::numeric + delta)::uint256 AS "balance"
      FROM
        unnest($2::address[], $3::numeric(78, 0)[]) AS inputs(account, delta)
        LEFT OUTER JOIN (
          SELECT account, balance FROM erc20_balances
          WHERE currency_id = $1::currencyid
        ) AS erc20_balances USING (account)
    )
    INSERT INTO erc20_balances (currency_id, account, balance)
    SELECT $1::currencyid, account, balance FROM new_balances
    ON CONFLICT (currency_id, account) DO UPDATE
      SET balance = EXCLUDED.balance::uint256
    RETURNING account, balance
    `,
    [
      currencyId,
      Array.from(accountUpdates.keys(), hexToBuf),
      Array.from(accountUpdates.values(), (x) => String(x.delta)),
    ]
  );
  // Make sure no intermediate step took us out of `uint256` range, since that
  // could make it impossible to roll back a block.
  for (const row of insertRes.rows) {
    const account = bufToAddress(row.account);
    const update = accountUpdates.get(account.toLowerCase());
    const finalBalance = ethers.BigNumber.from(row.balance);
    const initialBalance = finalBalance.sub(update.delta);
    const min = initialBalance.add(update.minDelta);
    const max = initialBalance.add(update.maxDelta);
    if (min.lt(ethers.constants.Zero)) {
      throw new Error(
        `account ${account} balance of currency ${currencyId} dropped below zero to ${min}`
      );
    }
    if (max.gt(ethers.constants.MaxUint256)) {
      throw new Error(
        `account ${account} balance of currency ${currencyId} rose above MaxUint256 to ${max}`
      );
    }
  }

  if (!skipActivityUpdates)
    await orderbook.updateActivityForCurrencyBalances({
      client,
      updates: insertRes.rows.map((r) => ({
        account: bufToAddress(r.account),
        newBalance: r.balance,
      })),
    });

  if (!alreadyInTransaction) await client.query("COMMIT");
}

async function deleteErc20Deltas({
  client,
  currencyId,
  blockHash,
  skipActivityUpdates = false,
  alreadyInTransaction = true,
}) {
  if (!alreadyInTransaction) await client.query("BEGIN");
  const deleteRes = await client.query(
    `
    DELETE FROM erc20_deltas
    WHERE currency_id = $1::currencyid AND block_hash = $2::bytes32
    RETURNING account, delta
    `,
    [currencyId, hexToBuf(blockHash)]
  );
  const updateRes = await client.query(
    `
    UPDATE erc20_balances
    SET balance = balance - delta
    FROM unnest($2::address[], $3::numeric(78, 0)[]) AS inputs(account, delta)
    WHERE
      currency_id = $1::currencyid
      AND erc20_balances.account = inputs.account
    RETURNING erc20_balances.account, balance
    `,
    [
      currencyId,
      deleteRes.rows.map((r) => r.account),
      deleteRes.rows.map((r) => r.delta),
    ]
  );
  if (!skipActivityUpdates) {
    await orderbook.updateActivityForCurrencyBalances({
      client,
      updates: updateRes.rows.map((r) => ({
        account: bufToAddress(r.account),
        newBalance: r.balance,
      })),
    });
  }
  if (!alreadyInTransaction) await client.query("COMMIT");
  return updateRes.rowCount;
}

module.exports = {
  getJobs,
  addJob,
  updateJobProgress,
  updateJobSpec,

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

  addFills,
  deleteFills,
  fillsByToken,
  lastFillsByProject,

  addErc20Deltas,
  deleteErc20Deltas,
};
