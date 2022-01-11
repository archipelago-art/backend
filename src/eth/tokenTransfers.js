const ethers = require("ethers");
const erc721Abi = require("./erc721Abi");
const {
  CONTRACT_ARTBLOCKS_STANDARD,
  CONTRACT_ARTBLOCKS_LEGACY,
} = require("../db/artblocks");
const { addTransfers } = require("../db/erc721Transfers");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);

async function erc721Transfers({ apiKey, tokenAddress, fromBlock, toBlock }) {
  const provider = new ethers.providers.AlchemyProvider(null, apiKey);
  const contract = new ethers.Contract(tokenAddress, erc721Abi, provider);
  return await contract.queryFilter(
    contract.filters.Transfer(),
    fromBlock,
    toBlock
  );
}

async function main() {
  require("dotenv").config();
  const apiKey = process.env.ALCHEMY_API_KEY;
  const fromBlock = 11341538;
  const toBlock = 11341538;
  log.debug`sending Alchemy request`;
  const transfers = await erc721Transfers({
    apiKey,
    tokenAddress: CONTRACT_ARTBLOCKS_LEGACY,
    fromBlock,
    toBlock,
  });
  log.debug`got ${transfers.length} transfers`;
  await withClient(async (client) => {
    await addTransfers({ client, transfers });
  });
  log.debug`wrote to db! :-)`;
}

main();
