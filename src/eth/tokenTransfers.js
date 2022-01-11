const ethers = require("ethers");
const erc721Abi = require("./erc721Abi");
const { addTransfers, getLastBlockNumber } = require("../db/erc721Transfers");
const { acqrel } = require("../db/util");
const log = require("../util/log")(__filename);

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

async function ingestTransfers({ pool, contractAddress, initialStartBlock }) {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (apiKey == null) throw new Error("missing ALCHEMY_API_KEY");
  const provider = new ethers.providers.AlchemyProvider(null, apiKey);

  const lastFetchedBlock = await acqrel(pool, (client) =>
    getLastBlockNumber({ client, contractAddress })
  );
  log.debug`got last block number ${lastFetchedBlock} for ${contractAddress}`;
  const startBlock =
    lastFetchedBlock == null ? initialStartBlock : lastFetchedBlock + 1;

  const head = (await provider.getBlock("latest")).number;
  log.debug`will request blocks ${startBlock}..=${head}`;

  const STRIDE = 2000;
  for (
    let fromBlock = startBlock, toBlock = startBlock + STRIDE - 1;
    fromBlock < head;
    fromBlock += STRIDE, toBlock += STRIDE
  ) {
    log.debug`requesting transfers for ${contractAddress} in blocks ${fromBlock}..=${toBlock}`;
    const transfers = await erc721Transfers({
      provider,
      contractAddress,
      fromBlock,
      toBlock,
    });
    log.debug`got ${transfers.length} transfers; sending to DB`;
    const res = await acqrel(pool, (client) =>
      addTransfers({ client, transfers })
    );
    log.debug`inserted ${res.inserted}; deferred ${res.deferred}`;
  }
}

module.exports = {
  ingestTransfers,
};
