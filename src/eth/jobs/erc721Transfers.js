const ethers = require("ethers");

const artblocks = require("../../db/artblocks");
const eth = require("../../db/eth");
const tokens = require("../../db/tokens");
const { fetchProjectData } = require("../../scrape/fetchArtblocksProject");
const log = require("../../util/log")(__filename);
const retryEthers = require("../../util/retryEthers");
const ERC_721_ABI = require("../erc721Abi");

class Erc721TransfersJob {
  constructor({ address, startBlock }) {
    this._address = ethers.utils.getAddress(address);
    this._startBlock = startBlock != null ? startBlock : -1;
    this._log = log.child(this._address);
  }

  _makeContract(provider) {
    return new ethers.Contract(this._address, ERC_721_ABI, provider);
  }

  name() {
    return `erc721Transfers(${this._address})`;
  }

  startBlock() {
    return this._startBlock;
  }

  blockBatchSize() {
    return 2000;
  }

  async up({ client, provider, minBlock, maxBlock }) {
    const contract = this._makeContract(provider);
    const rawTransfers = await retryEthers(() =>
      contract.queryFilter(contract.filters.Transfer(), minBlock, maxBlock)
    );
    const transfers = [];
    let newTokens = 0;
    for (const transfer of rawTransfers) {
      const { blockHash, blockNumber, logIndex, transactionHash } = transfer;
      const { from, to } = transfer.args;
      const onChainTokenId = String(transfer.args.tokenId);
      const { tokenId, added } = await getOrAddTokenId({
        client,
        tokenContract: contract.address,
        onChainTokenId,
        blockHash,
      });
      transfers.push({
        tokenId,
        fromAddress: transfer.args.from,
        toAddress: transfer.args.to,
        blockHash,
        logIndex,
        transactionHash,
      });
      if (added) newTokens++;
    }
    await eth.addErc721Transfers({ client, transfers });
    const n = transfers.length;
    this._log
      .info`up(${minBlock}..=${maxBlock}): added ${n} transfers with ${newTokens} new tokens`;
  }

  async down({ client, blockHash }) {
    const tokenContract = this._address;
    const n = await eth.deleteErc721Transfers({
      client,
      blockHash,
      tokenContract,
    });
    // TODO(@wchargin): Roll back token creations, cascading?
    this._log.info`down(${blockHash}): deleted ${n} transfers`;
  }
}

async function getOrAddTokenId({
  client,
  tokenContract,
  onChainTokenId,
  blockHash,
}) {
  const existing = await tokens.tokenIdByChainData({
    client,
    tokenContract,
    onChainTokenId,
    blockHash,
  });
  if (existing != null) return { tokenId: existing, added: false };

  if (
    tokenContract !== artblocks.CONTRACT_ARTBLOCKS_STANDARD &&
    tokenContract !== artblocks.CONTRACT_ARTBLOCKS_LEGACY
  ) {
    throw new Error(
      `can't add new tokens for non-Art Blocks contract: ${tokenContract} #${onChainTokenId} (from ${blockHash})`
    );
  }

  const { artblocksProjectIndex } = artblocks.splitOnChainTokenId(
    Number(onChainTokenId)
  );
  await ensureArtblocksProjectExists({ client, artblocksProjectIndex });
  log.trace`adding Art Blocks token #${onChainTokenId}`;
  const { tokenId } = await artblocks.addBareToken({
    client,
    artblocksTokenId: Number(onChainTokenId),
    alreadyInTransaction: true,
  });
  return { tokenId, added: true };
}

async function ensureArtblocksProjectExists({ client, artblocksProjectIndex }) {
  const existing = await artblocks.projectIdsFromArtblocksIndices({
    client,
    indices: [artblocksProjectIndex],
  });
  if (existing[0] != null) return;

  const project = await fetchProjectData(artblocksProjectIndex);
  if (project == null) {
    throw new Error(
      `can't add phantom Art Blocks project ${artblocksProjectIndex}`
    );
  }
  log.info`adding Art Blocks project #${artblocksProjectIndex}: ${project?.name}`;
  await artblocks.addProject({
    client,
    project,
    alreadyInTransaction: true,
  });
}

function makeErc721TransfersJob(options) {
  return new Erc721TransfersJob(options);
}

module.exports = makeErc721TransfersJob;