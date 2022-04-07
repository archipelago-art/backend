const ethers = require("ethers");

const artblocks = require("../db/artblocks");
const {
  addBlocks,
  addTransfers,
  getLastBlockNumber,
  undeferTransfers: _undeferTransfers,
} = require("../db/erc721Transfers");
const { acqrel } = require("../db/util");
const adHocPromise = require("../util/adHocPromise");
const log = require("../util/log")(__filename);
const parmap = require("../util/parmap");
const retry = require("../util/retry");
const erc721Abi = require("./erc721Abi");

const BLOCK_CONCURRENCY = 16; // how many concurrent calls to `getBlock`?

const AUTOGLYPH_CONTRACT = {
  // Autoglyphs
  address: "0xd4e4078ca3495de5b1d4db434bebc5a986197782",
  startBlock: 7510386,
};

const CRYPTOADZ_CONTRACT = {
  address: "0x1cb1a5e65610aeff2551a50f76a87a7d3fb649c6",
  startBlock: 13186834,
};

const CONTRACTS = [
  { address: artblocks.CONTRACT_ARTBLOCKS_LEGACY, startBlock: 11341469 },
  { address: artblocks.CONTRACT_ARTBLOCKS_STANDARD, startBlock: 11438389 },
  AUTOGLYPH_CONTRACT,
  CRYPTOADZ_CONTRACT,
];

const TESTNET_AUTOGLYPH_CONTRACT = {
  address: "0xa9e6b6DF4FaE40a505bBb66a9B7E440acda5C371",
  startBlock: 10418112,
};

const TESTNET_CONTRACTS = [TESTNET_AUTOGLYPH_CONTRACT];

function makeProvider() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (apiKey == null) throw new Error("missing ALCHEMY_API_KEY");
  const network = process.env.TESTNET === "rinkeby" ? "rinkeby" : "homestead";
  return new ethers.providers.AlchemyProvider(network, apiKey);
}

const retryableCodes = [
  ethers.errors.SERVER_ERROR,
  ethers.errors.NETWORK_ERROR,
  ethers.errors.TIMEOUT,
];

async function retryEthers(cb) {
  async function attempt() {
    try {
      const value = await cb();
      return { type: "DONE", value };
    } catch (e) {
      if (e.code != null && retryableCodes.includes(e.code)) {
        log.debug`retrying Ethers operation due to ${e.code}: ${e}`;
        return { type: "RETRY", err: e };
      }
      return { type: "FATAL", err: e };
    }
  }
  const res = await retry(attempt);
  if (res.type === "DONE") {
    return res.value;
  } else {
    throw res.err;
  }
}

async function ingestTransfersLive({ pool }) {
  const provider = makeProvider();
  const contracts =
    process.env.TESTNET === "rinkeby" ? TESTNET_CONTRACTS : CONTRACTS;
  await Promise.all(
    contracts.map((contract) =>
      ingestTransfersLiveForContract({ pool, provider, contract })
    )
  );
}

async function ingestTransfersLiveForContract({ pool, provider, contract }) {
  let lastFetchedBlock = await acqrel(pool, (client) =>
    getLastBlockNumber({ client, contractAddress: contract.address })
  );
  log.debug`contract ${contract.address}: got last block number ${lastFetchedBlock}`;

  let head = (await retryEthers(() => provider.getBlock("latest"))).number;
  let newBlocks = adHocPromise();
  provider.on("block", (blockNumber) => {
    head = blockNumber;
    newBlocks.resolve();
  });

  do {
    const startBlock =
      lastFetchedBlock == null ? contract.startBlock : lastFetchedBlock + 1;
    const endBlock = head;
    if (startBlock > endBlock) {
      log.debug`contract ${contract.address}: already up to date (${startBlock} > ${endBlock}); sleeping`;
      continue;
    }
    log.debug`contract ${contract.address}: will fetch ${startBlock}..=${endBlock}`;
    const nTransfers = await ingestTransfers({
      provider,
      pool,
      contractAddress: contract.address,
      startBlock,
      endBlock,
    });
    lastFetchedBlock = endBlock;
    if (nTransfers > 0) {
      log.info`contract ${contract.address}: found ${nTransfers} transfers in ${startBlock}..=${endBlock}`;
    }
    log.debug`contract ${contract.address}: fetched through ${endBlock}; sleeping`;
  } while ((await newBlocks.promise, (newBlocks = adHocPromise()), true));
}

async function ingestTransfersInRange({
  pool,
  contractAddress,
  startBlock,
  endBlock,
}) {
  const provider = makeProvider();
  log.debug`will request blocks ${startBlock}..=${endBlock}`;
  return await ingestTransfers({
    provider,
    pool,
    contractAddress,
    startBlock,
    endBlock,
  });
}

async function ingestTransfers({
  provider,
  pool,
  contractAddress,
  startBlock,
  endBlock,
}) {
  const ethersContract = new ethers.Contract(
    contractAddress,
    erc721Abi,
    provider
  );
  let totalTransfers = 0;
  const STRIDE = 2000;
  for (
    let fromBlock = startBlock, toBlock = startBlock + STRIDE - 1;
    fromBlock <= endBlock;
    fromBlock += STRIDE, toBlock += STRIDE
  ) {
    log.debug`requesting transfers for ${contractAddress} in blocks ${fromBlock}..=${toBlock}`;
    const transfers = await retryEthers(() =>
      ethersContract.queryFilter(
        ethersContract.filters.Transfer(),
        fromBlock,
        Math.min(toBlock, endBlock)
      )
    );
    totalTransfers += transfers.length;
    const blockHashes = Array.from(new Set(transfers.map((t) => t.blockHash)));
    log.debug`got ${transfers.length} transfers over ${blockHashes.length} distinct blocks`;
    await _ingestBlocks({
      pool,
      provider,
      blockHashes,
      batchSize: BLOCK_CONCURRENCY,
    });
    const res = await acqrel(pool, (client) =>
      addTransfers({ client, transfers })
    );
    log.debug`inserted ${res.inserted} transfers; deferred ${res.deferred}`;
  }
  log.debug`done with transfers for ${contractAddress} through ${endBlock}`;
  return totalTransfers;
}

async function ingestBlocks({ pool, blockHashes, batchSize }) {
  const provider = makeProvider();
  return await _ingestBlocks({ pool, provider, blockHashes, batchSize });
}

async function _ingestBlocks({ pool, provider, blockHashes, batchSize }) {
  const blocks = await parmap(batchSize, blockHashes, (blockHash) =>
    retryEthers(() => {
      log.trace`requesting data for block ${blockHash}`;
      return provider.getBlock(blockHash);
    })
  );
  const nBlocks = await acqrel(pool, (client) => addBlocks({ client, blocks }));
  log.debug`added ${blocks.length} blocks (${nBlocks} new)`;
  return nBlocks;
}

async function undeferTransfers({ pool }) {
  const n = await acqrel(pool, (client) => _undeferTransfers({ client }));
  log.info`undeferred ${n} events`;
}

module.exports = {
  ingestTransfersLive,
  ingestTransfersInRange,
  ingestBlocks,
  undeferTransfers,
};
