const ethers = require("ethers");

const artblocks = require("../../db/artblocks");
const eth = require("../../db/eth");
const safeQueryFilter = require("../../db/safeQueryFilter");
const tokens = require("../../db/tokens");
const { fetchProjectData } = require("../../scrape/fetchArtblocksProject");
const log = require("../../util/log")(__filename);
const retryEthers = require("../../util/retryEthers");

const CANCELLATIONS_ABI = [
  "event NonceCancellation(address indexed participant, uint256 indexed nonce)",
];

class NonceCancellationsJob {
  constructor({ address, startBlock }) {
    this._address = ethers.utils.getAddress(address);
    this._startBlock = startBlock != null ? startBlock : -1;
    this._log = log.child(this._address);
  }

  _makeContract(provider) {
    return new ethers.Contract(this._address, CANCELLATIONS_ABI, provider);
  }

  name() {
    return `nonceCancellations(${this._address})`;
  }

  startBlock() {
    return this._startBlock;
  }

  blockBatchSize() {
    return 2000;
  }

  async up({ client, provider, minBlock, maxBlock }) {
    const contract = this._makeContract(provider);
    const rawEvents = await safeQueryFilter({
      client,
      provider,
      contract,
      filter: contract.filters.NonceCancellation(),
      minBlock,
      maxBlock,
    });

    const cancellations = rawEvents.map((ev) => {
      const { blockHash, logIndex, transactionHash } = ev;
      const account = ev.args.participant;
      const nonce = String(ev.args.nonce);
      return { account, nonce, blockHash, logIndex, transactionHash };
    });
    const actualAdded = await eth.addNonceCancellations({
      client,
      marketContract: this._address,
      cancellations,
      alreadyInTransaction: true,
    });
    this._log
      .info`up(${minBlock}..=${maxBlock}): added ${actualAdded}/${cancellations.length} nonce cancellations`;
  }

  async down({ client, blockHash }) {
    const n = await eth.deleteNonceCancellations({
      client,
      blockHash,
      marketContract: this._address,
    });
    this._log.info`down(${blockHash}): deleted ${n} nonce cancellations`;
  }
}

function makeNonceCancellationsJob(options) {
  return new NonceCancellationsJob(options);
}

module.exports = makeNonceCancellationsJob;
