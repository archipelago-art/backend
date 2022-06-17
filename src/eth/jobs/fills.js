const ethers = require("ethers");

const artblocks = require("../../db/artblocks");
const eth = require("../../db/eth");
const safeQueryFilter = require("../../db/safeQueryFilter");
const tokens = require("../../db/tokens");
const { fetchProjectData } = require("../../scrape/fetchArtblocksProject");
const log = require("../../util/log")(__filename);
const retryEthers = require("../../util/retryEthers");

const FILLS_ABI = [
  "event Trade(bytes32 indexed tradeId, address indexed buyer, address indexed seller, uint256 price, uint256 proceeds, uint256 cost, address currency)",
  "event TokenTrade(bytes32 indexed tradeId, address indexed tokenAddress, uint256 indexed tokenId)",
];

class FillsJob {
  constructor({ address, startBlock }) {
    this._address = ethers.utils.getAddress(address);
    this._startBlock = startBlock != null ? startBlock : -1;
    this._log = log.child(this._address);
  }

  _makeContract(provider) {
    return new ethers.Contract(this._address, FILLS_ABI, provider);
  }

  name() {
    return `fills(${this._address})`;
  }

  startBlock() {
    return this._startBlock;
  }

  blockBatchSize() {
    return 2000;
  }

  async up({ client, provider, minBlock, maxBlock }) {
    const contract = this._makeContract(provider);
    const filters = [contract.filters.Trade(), contract.filters.TokenTrade()];
    const filter = {
      address: contract.address,
      topics: [filters.map((f) => f.topics[0])],
    };
    const rawEvents = await safeQueryFilter({
      client,
      provider,
      contract,
      filter,
      minBlock,
      maxBlock,
    });

    const fills = [];
    let current = null;
    // Expect a sequence of alternating `Token` and `TokenTrade` events.
    for (const ev of rawEvents) {
      function err(msg) {
        throw new Error(
          `${msg} at blockHash=${ev.blockHash}, logIndex=${ev.logIndex}`
        );
      }
      const { name, args } = contract.interface.parseLog(ev);
      switch (name) {
        case "Trade": {
          if (current != null) throw err("unexpected Trade");
          current = {
            tradeId: args.tradeId,
            buyer: args.buyer,
            seller: args.seller,
            price: args.price,
            proceeds: args.proceeds,
            cost: args.cost,
            currency: args.currency,

            blockHash: ev.blockHash,
            logIndex: ev.logIndex,
            transactionHash: ev.transactionHash,
          };
          break;
        }
        case "TokenTrade": {
          if (current == null) throw err("unexpected TokenTrade");
          if (
            ev.blockHash !== current.blockHash ||
            ev.logIndex !== current.logIndex + 1
          )
            throw err("unexpected event sequencing");
          if (args.tradeId !== current.tradeId) throw err("`tradeId` mismatch");
          current.tokenContract = args.tokenAddress;
          current.onChainTokenId = args.tokenId;
          fills.push(current);
          current = null;
          break;
        }
        default:
          throw err(`unexpected event name ${JSON.stringify(name)}`);
      }
    }
    if (fills.length > 0) {
      await eth.addFills({
        client,
        marketContract: this._address,
        fills,
        alreadyInTransaction: true,
      });
    }
    this._log.info`up(${minBlock}..=${maxBlock}): added ${fills.length} fills`;
  }

  async down({ client, blockHash }) {
    const n = await eth.deleteFills({
      client,
      blockHash,
      marketContract: this._address,
    });
    this._log.info`down(${blockHash}): deleted ${n} fills`;
  }
}

function makeFillsJob(options) {
  return new FillsJob(options);
}

module.exports = makeFillsJob;
