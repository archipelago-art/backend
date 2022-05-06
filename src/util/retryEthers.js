const ethers = require("ethers");

const log = require("./log")(__filename);
const retry = require("./retry");

const retryableCodes = [
  ethers.errors.SERVER_ERROR,
  ethers.errors.NETWORK_ERROR,
  ethers.errors.TIMEOUT,
];

async function retryEthers(cb) {
  async function attempt() {
    try {
      const value = await cb();
      return { type: "DONE", value };
    } catch (e) {
      if (e.code != null && retryableCodes.includes(e.code)) {
        log.debug`retrying Ethers operation due to ${e.code}: ${e}`;
        return { type: "RETRY", err: e };
      }
      return { type: "FATAL", err: e };
    }
  }
  const res = await retry(attempt);
  if (res.type === "DONE") {
    return res.value;
  } else {
    throw res.err;
  }
}

module.exports = retryEthers;
