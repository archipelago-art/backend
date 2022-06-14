const retryEthers = require("../util/retryEthers");
const log = require("../util/log")(__filename);
const eth = require("./eth");

async function safeQueryFilter({
  client,
  provider,
  contract,
  filter,
  minBlock,
  maxBlock,
  safetyMargin = 10,
}) {
  // Partition (minBlock..=maxBlock) into two ranges: the "safe range"
  // in which we can send block-number queries without worrying about
  // reorgs, and the "volatile range" where we query by block hash.
  const remoteHead = await provider.getBlockNumber();
  const lastSafeBlock = remoteHead - safetyMargin;

  const queries = [];

  const minSafeBlock = minBlock;
  const maxSafeBlock = Math.min(maxBlock, lastSafeBlock);
  let nSafeQueries = 0;
  if (maxSafeBlock >= minSafeBlock) {
    nSafeQueries = 1;
    queries.push(
      retryEthers(() =>
        contract.queryFilter(filter, minSafeBlock, maxSafeBlock)
      )
    );
  }

  const minVolatileBlock = Math.max(minBlock, lastSafeBlock + 1);
  const maxVolatileBlock = maxBlock;
  let nVolatileQueries = 0;
  if (maxVolatileBlock >= minVolatileBlock) {
    nVolatileQueries = maxVolatileBlock + 1 - minVolatileBlock;
    const blockHeaders = await eth.getBlockHeaders({
      client,
      fromNumber: minVolatileBlock,
      toNumber: maxVolatileBlock + 1,
    });
    if (blockHeaders.length !== nVolatileQueries) {
      throw new Error(
        `expected ${nVolatileQueries} headers in ${minVolatileBlock}..=${maxVolatileBlock}, got ${blockHeaders.length}`
      );
    }
    for (const { blockHash } of blockHeaders) {
      queries.push(retryEthers(() => contract.queryFilter(filter, blockHash)));
    }
  }

  log.trace`remoteHead:${remoteHead}, lastSafeBlock:${lastSafeBlock}, safe:${minSafeBlock}..=${maxSafeBlock}(${nSafeQueries}q), volatile:${minVolatileBlock}..=${maxVolatileBlock}(${nVolatileQueries}q)`;

  return (await Promise.all(queries)).flat();
}

module.exports = safeQueryFilter;
