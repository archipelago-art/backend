const ethers = require("ethers");

const artblocks = require("../db/artblocks");
const { addTransfers, getLastBlockNumber } = require("../db/erc721Transfers");
const { acqrel } = require("../db/util");
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

async function ingestTransfersHistorical({ pool }) {
  const provider = makeProvider();
  await Promise.all(
    CONTRACTS.map((contract) =>
      ingestTransfersHistoricalForContract({ pool, provider, contract })
    )
  );
}

async function ingestTransfersHistoricalForContract({
  pool,
  provider,
  contract,
}) {
  const contractAddress = contract.address;
  const lastFetchedBlock = await acqrel(pool, (client) =>
    getLastBlockNumber({ client, contractAddress })
  );
  log.debug`got last block number ${lastFetchedBlock} for ${contractAddress}`;
  const startBlock =
    lastFetchedBlock == null ? contract.startBlock : lastFetchedBlock + 1;

  const head = (await provider.getBlock("latest")).number;
  log.debug`will request blocks ${startBlock}..=${head}`;
  return await ingestTransfers({
    provider,
    pool,
    contractAddress,
    startBlock,
    endBlock: head,
  });
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
  const STRIDE = 2000;
  for (
    let fromBlock = startBlock, toBlock = startBlock + STRIDE - 1;
    fromBlock < endBlock;
    fromBlock += STRIDE, toBlock += STRIDE
  ) {
    log.debug`requesting transfers for ${contractAddress} in blocks ${fromBlock}..=${toBlock}`;
    const transfers = await ethersContract.queryFilter(
      ethersContract.filters.Transfer(),
      fromBlock,
      Math.min(toBlock, endBlock)
    );
    log.debug`got ${transfers.length} transfers; sending to DB`;
    const res = await acqrel(pool, (client) =>
      addTransfers({ client, transfers })
    );
    log.debug`inserted ${res.inserted}; deferred ${res.deferred}`;
  }
  log.debug`done with transfers for ${contractAddress} through ${endBlock}`;
}

module.exports = {
  ingestTransfersHistorical,
  ingestTransfersInRange,
};
