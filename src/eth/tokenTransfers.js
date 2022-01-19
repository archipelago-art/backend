const ethers = require("ethers");
const erc721Abi = require("./erc721Abi");
const { addTransfers, getLastBlockNumber } = require("../db/erc721Transfers");
const { acqrel } = require("../db/util");
const log = require("../util/log")(__filename);

function makeProvider() {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (apiKey == null) throw new Error("missing ALCHEMY_API_KEY");
  return new ethers.providers.AlchemyProvider(null, apiKey);
}

async function erc721Transfers({
  provider,
  contractAddress,
  fromBlock,
  toBlock,
}) {
  const contract = new ethers.Contract(contractAddress, erc721Abi, provider);
  return await contract.queryFilter(
    contract.filters.Transfer(),
    fromBlock,
    toBlock
  );
}

async function ingestTransfersHistorical({
  pool,
  contractAddress,
  initialStartBlock,
}) {
  const provider = makeProvider();
  const lastFetchedBlock = await acqrel(pool, (client) =>
    getLastBlockNumber({ client, contractAddress })
  );
  log.debug`got last block number ${lastFetchedBlock} for ${contractAddress}`;
  const startBlock =
    lastFetchedBlock == null ? initialStartBlock : lastFetchedBlock + 1;

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

async function ingestTransfers({
  provider,
  pool,
  contractAddress,
  startBlock,
  endBlock,
}) {
  const STRIDE = 2000;
  for (
    let fromBlock = startBlock, toBlock = startBlock + STRIDE - 1;
    fromBlock < endBlock;
    fromBlock += STRIDE, toBlock += STRIDE
  ) {
    log.debug`requesting transfers for ${contractAddress} in blocks ${fromBlock}..=${toBlock}`;
    const transfers = await erc721Transfers({
      provider,
      contractAddress,
      fromBlock,
      toBlock: Math.min(toBlock, endBlock),
    });
    log.debug`got ${transfers.length} transfers; sending to DB`;
    const res = await acqrel(pool, (client) =>
      addTransfers({ client, transfers })
    );
    log.debug`inserted ${res.inserted}; deferred ${res.deferred}`;
  }
}

module.exports = {
  ingestTransfersHistorical,
};
