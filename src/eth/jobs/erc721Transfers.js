const ethers = require("ethers");

const contracts = require("../../api/contracts");
const artblocks = require("../../db/artblocks");
const qql = require("../../db/qql");
const eth = require("../../db/eth");
const safeQueryFilter = require("../../db/safeQueryFilter");
const tokens = require("../../db/tokens");
const { fetchProjectData } = require("../../scrape/fetchArtblocksProject");
const log = require("../../util/log")(__filename);
const retryEthers = require("../../util/retryEthers");
const ERC_721_ABI = require("../erc721Abi");

class Erc721TransfersJob {
  constructor({ address }) {
    this._address = ethers.utils.getAddress(address);
    this._log = log.child(this._address);
  }

  _makeContract(provider) {
    return new ethers.Contract(this._address, ERC_721_ABI, provider);
  }

  name() {
    return `erc721Transfers(${this._address})`;
  }

  blockBatchSize() {
    return 2000;
  }

  async up({ client, provider, minBlock, maxBlock }) {
    const contract = this._makeContract(provider);
    const rawTransfers = await safeQueryFilter({
      client,
      provider,
      contract,
      filter: contract.filters.Transfer(),
      minBlock,
      maxBlock,
    });
    const transfers = [];
    let newTokens = 0;
    for (const transfer of rawTransfers) {
      const { blockHash, blockNumber, logIndex, transactionHash } = transfer;
      const { from, to } = transfer.args;
      const onChainTokenId = String(transfer.args.tokenId);
      const tokenTracking = await getTokenTracking({
        client,
        tokenContract: contract.address,
        onChainTokenId,
        blockHash,
      });
      if (tokenTracking.tracked) {
        transfers.push({
          tokenId: tokenTracking.tokenId,
          fromAddress: transfer.args.from,
          toAddress: transfer.args.to,
          blockHash,
          logIndex,
          transactionHash,
        });
        if (tokenTracking.added) newTokens++;
      }
    }
    const actualAdded = await eth.addErc721Transfers({
      client,
      transfers,
      alreadyInTransaction: true,
    });
    this._log
      .info`up(${minBlock}..=${maxBlock}): added ${actualAdded}/${transfers.length} transfers with ${newTokens} new tokens`;
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

// Returns one of the following:
// {tracked: true, tokenId, added: bool}
// {tracked: false}
// The reason we are expecting untracked tokens is because we
// are not tracking all the projects on the ArtBlocks contract.
async function getTokenTracking({
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
  if (existing != null)
    return { tracked: true, tokenId: existing, added: false };

  if (tokenContract === contracts.qqlMintPass.address) {
    const tokenId = await qql.addMintPass({ client, onChainTokenId });
    return { tracked: true, tokenId, added: true };
  }
  if (tokenContract === contracts.qql.address) {
    const tokenId = await qql.addQql({ client, onChainTokenId });
    return { tracked: true, tokenId, added: true };
  }

  if (
    tokenContract !== artblocks.CONTRACT_ARTBLOCKS_STANDARD &&
    tokenContract !== artblocks.CONTRACT_ARTBLOCKS_LEGACY &&
    tokenContract !== contracts.brightMoments.address
  ) {
    throw new Error(
      `can't add new tokens for non-Art Blocks contract: ${tokenContract} #${onChainTokenId} (from ${blockHash})`
    );
  }

  const { artblocksProjectIndex } = artblocks.splitOnChainTokenId(
    Number(onChainTokenId)
  );
  const spec = { projectIndex: artblocksProjectIndex, tokenContract };
  const exists = await doesArtblocksProjectExist({ client, spec });
  if (exists) {
    log.trace`adding Art Blocks token #${onChainTokenId}`;
    const { tokenId } = await artblocks.addBareToken({
      client,
      tokenContract,
      artblocksTokenId: Number(onChainTokenId),
      alreadyInTransaction: true,
    });
    return { tracked: true, tokenId, added: true };
  } else {
    // An AB project we've chosen not to include in the database.
    return { tracked: false };
  }
}

async function doesArtblocksProjectExist({ client, spec }) {
  const existing = await artblocks.projectIdsFromArtblocksSpecs({
    client,
    specs: [spec],
  });

  return existing[0] != null;
}

async function ensureArtblocksProjectExists({ client, spec }) {
  const existing = await artblocks.projectIdsFromArtblocksSpecs({
    client,
    specs: [spec],
  });
  if (existing[0] != null) return;

  const project = await fetchProjectData(spec);
  if (project == null) {
    throw new Error(
      `can't add phantom Art Blocks project ${spec.tokenContract}-${spec.projectIndex}`
    );
  }
  log.info`adding Art Blocks project #${spec.tokenContract} #${spec.artblocksProjectIndex}: ${project?.name}`;
  await artblocks.addProject({
    client,
    project,
    tokenContract: spec.tokenContract,
    alreadyInTransaction: true,
  });
}

function makeErc721TransfersJob(options) {
  return new Erc721TransfersJob(options);
}

module.exports = makeErc721TransfersJob;
