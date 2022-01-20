const ethers = require("ethers");

const artblocks = require("../db/artblocks");
const { addTransfers, getLastBlockNumber } = require("../db/erc721Transfers");
const { acqrel } = require("../db/util");
const adHocPromise = require("../util/adHocPromise");
const log = require("../util/log")(__filename);
const erc721Abi = require("./erc721Abi");

const CONTRACTS = [
  { address: artblocks.CONTRACT_ARTBLOCKS_LEGACY, startBlock: 11341469 },
  { address: artblocks.CONTRACT_ARTBLOCKS_STANDARD, startBlock: 11438389 },
];

function makeProvider() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (apiKey == null) throw new Error("missing ALCHEMY_API_KEY");
  return new ethers.providers.AlchemyProvider(null, apiKey);
}

async function ingestTransfersLive({ pool }) {
  const provider = makeProvider();
  await Promise.all(
    CONTRACTS.map((contract) =>
      ingestTransfersLiveForContract({ pool, provider, contract })
    )
  );
}

async function ingestTransfersLiveForContract({ pool, provider, contract }) {
  let lastFetchedBlock = await acqrel(pool, (client) =>
    getLastBlockNumber({ client, contractAddress: contract.address })
  );
  log.debug`contract ${contract.address}: got last block number ${lastFetchedBlock}`;

  let head = (await provider.getBlock("latest")).number;
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
    const transfers = await ethersContract.queryFilter(
      ethersContract.filters.Transfer(),
      fromBlock,
      Math.min(toBlock, endBlock)
    );
    totalTransfers += transfers.length;
    log.debug`got ${transfers.length} transfers; sending to DB`;
    const res = await acqrel(pool, (client) =>
      addTransfers({ client, transfers })
    );
    log.debug`inserted ${res.inserted}; deferred ${res.deferred}`;
  }
  log.debug`done with transfers for ${contractAddress} through ${endBlock}`;
  return totalTransfers;
}

module.exports = {
  ingestTransfersLive,
  ingestTransfersInRange,
};
