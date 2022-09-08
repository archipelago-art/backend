const { isAddress } = require("ethers/lib/utils");
const { withClient, withPool } = require("../db/util");
const log = require("../util/log")(__filename);
const digest = require("../email/digest");
const luxon = require("luxon");

const DELAY_MS = 1000 * 60 * 15;

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

async function sendEmailDigests(args) {
  let testRun = false;
  if (args.length > 0 && args[0] === "-t") {
    // Send a test digest for the specified account and email
    testRun = true;
    args.shift();
    const [account, email] = args;
    if (!isAddress(account) || !email) {
      throw new Error(
        `Invalid parameters: ${account} ${email}. To send a test email use: -t <account> <email>`
      );
    }
    const lastEmailTime = luxon.DateTime.local().minus({ days: 2 }).toJSDate();
    await withClient(async (client) => {
      await digest.sendOneDigest({
        client,
        account,
        email,
        lastEmailTime,
        isTestEmail: true,
      });
    });
  } else {
    // No test run, send all digest emails
    await withPool(async (pool) => {
      while (true) {
        await digest.sendAllDigests({ pool });
        await sleepMs(DELAY_MS);
      }
    });
  }
}

module.exports = sendEmailDigests;
