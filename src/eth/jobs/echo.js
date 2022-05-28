const log = require("../../util/log")(__filename);

class EchoJob {
  name() {
    return "echo";
  }

  initialLastBlockNumber() {
    return -1;
  }

  blockBatchSize() {
    return 1e6;
  }

  async up({ client, provider, minBlock, maxBlock }) {
    log.info`echo-up(${minBlock}..=${maxBlock})`;
  }

  async down({ client, blockHash, blockNumber }) {
    log.info`echo-down(${blockHash}, #${blockNumber})`;
  }
}

function makeEchoJob() {
  return new EchoJob();
}

module.exports = makeEchoJob;
