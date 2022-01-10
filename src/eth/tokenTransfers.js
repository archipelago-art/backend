const ethers = require("ethers");
const erc721Abi = require("./erc721Abi");
const {
  CONTRACT_ARTBLOCKS_STANDARD,
  CONTRACT_ARTBLOCKS_LEGACY,
} = require("../db/artblocks");

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
  const transfers = await erc721Transfers({
    apiKey,
    tokenAddress: CONTRACT_ARTBLOCKS_LEGACY,
    fromBlock,
    toBlock,
  });
  console.log(transfers);
}

main();
