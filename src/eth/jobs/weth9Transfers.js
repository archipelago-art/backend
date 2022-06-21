const ethers = require("ethers");

const eth = require("../../db/eth");
const safeQueryFilter = require("../../db/safeQueryFilter");
const log = require("../../util/log")(__filename);
const wellKnownCurrencies = require("../../db/wellKnownCurrencies");

const WETH9_ABI = [
  "event Deposit(address indexed account, uint amount)",
  "event Transfer(address indexed from, address indexed to, uint amount)",
  "event Withdrawal(address indexed account, uint amount)",
];

const WETH9 = wellKnownCurrencies.weth9;

class Weth9TransfersJob {
  _makeContract(provider) {
    return new ethers.Contract(WETH9.address, WETH9_ABI, provider);
  }

  name() {
    return "weth9Transfers";
  }

  blockBatchSize() {
    return 500;
  }

  async up({ client, provider, minBlock, maxBlock }) {
    const contract = this._makeContract(provider);
    const filters = [
      contract.filters.Deposit(),
      contract.filters.Transfer(),
      contract.filters.Withdrawal(),
    ];
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

    function neg(n) {
      return ethers.constants.Zero.sub(n);
    }

    const deltas = [];
    for (const ev of rawEvents) {
      const { name, args } = contract.interface.parseLog(ev);
      const { blockHash } = ev;
      function delta(account, delta) {
        return { blockHash, account, delta };
      }
      switch (name) {
        case "Deposit":
          deltas.push(delta(args.account, args.amount));
          break;
        case "Withdrawal":
          deltas.push(delta(args.account, neg(args.amount)));
          break;
        case "Transfer":
          deltas.push(delta(args.from, neg(args.amount)));
          deltas.push(delta(args.to, args.amount));
          break;
        default:
          throw err(
            `unexpected event name ${JSON.stringify(
              name
            )} at blockHash=${blockHash}, logIndex=${ev.logIndex}`
          );
      }
    }

    await eth.addErc20Deltas({
      client,
      currencyId: WETH9.currencyId,
      deltas,
      skipActivityUpdates: true,
      alreadyInTransaction: true,
    });
    log.info`up(${minBlock}..=${maxBlock}): added ${deltas.length} deltas`;
  }

  async down({ client, blockHash }) {
    const n = await eth.deleteErc20Deltas({
      client,
      currencyId: WETH9.currencyId,
      blockHash,
      skipActivityUpdates: true,
      alreadyInTransaction: true,
    });
    log.info`down(${blockHash}): updated balances for ${n} accounts`;
  }
}

function makeWeth9TransfersJob() {
  return new Weth9TransfersJob();
}

module.exports = makeWeth9TransfersJob;
