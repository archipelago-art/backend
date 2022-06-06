const artblocks = require("../db/artblocks");
const channels = require("../db/channels");
const tokens = require("../db/tokens");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);
const signal = require("../util/signal");

const BATCH_SIZE = 64;
const WAIT_DURATION_SECONDS = 60;

async function watchTokenTraitsQueue(args) {
  if (args.length !== 0) {
    console.error("usage: watch-token-traits-queue");
    return 1;
  }
  await withPool(async (pool) => {
    let newEventsSignal = signal();
    const channel = channels.newTokens;
    await acqrel(pool, async (listenClient) => {
      listenClient.on("notification", (n) => {
        if (n.channel !== channel.name) return;
        log.info`scheduling wake for new token event: ${n.payload}`;
        newEventsSignal.set();
      });
      await channel.listen(listenClient);

      while (true) {
        try {
          const n = await watchTokenTraitsQueueOnce(pool);
          if (n > 0) {
            log.info`made progress; checking queue again immediately`;
            continue;
          }
        } catch (e) {
          log.error`failed to process token traits; retrying immediately: ${e}`;
          continue;
        }
        log.info`sleeping for up to ${WAIT_DURATION_SECONDS} seconds`;
        const wakeReason = await newEventsSignal
          .waitAndReset(WAIT_DURATION_SECONDS * 1000)
          .then(() => "new tokens notification")
          .catch(() => "sleep");
        log.info`woke from ${wakeReason}`;
      }
    });
  });
}

async function watchTokenTraitsQueueOnce(pool) {
  return await acqrel(pool, async (client) => {
    await client.query("BEGIN");
    const tokenIds = await tokens.claimTokenTraitsQueueEntries({
      client,
      limit: BATCH_SIZE,
      alreadyInTransaction: true,
    });
    log.info`got ${tokenIds.length} token IDs to process`;
    if (tokenIds.length === 0) {
      await client.query("COMMIT");
      return 0;
    }
    const artblocksTokenIds = await artblocks.getArtblocksTokenIds({
      client,
      tokenIds,
    });
    const tokenData = await Promise.all(
      artblocksTokenIds.map(async ({ tokenId, artblocksTokenId }) => {
        const token = await fetchTokenData(artblocksTokenId).catch((e) => {
          log.warn`failed to fetch Art Blocks token #${artblocksTokenId}: ${e}`;
          return { found: false };
        });
        log.debug`token ${tokenId} (Art Blocks #${artblocksTokenId}): found=${token.found}`;
        if (!token.found) {
          return { tokenId, rawTokenData: null };
        }
        return { tokenId, rawTokenData: token.raw };
      })
    );
    let notFoundTokenIds = [];
    let doneCount = 0;
    for (const { tokenId, rawTokenData } of tokenData) {
      if (rawTokenData == null) {
        notFoundTokenIds.push(tokenId);
        continue;
      }
      await artblocks.updateTokenData({
        client,
        tokenId,
        rawTokenData,
        alreadyInTransaction: true,
      });
      doneCount++;
    }
    if (notFoundTokenIds.length > 0) {
      await tokens.enqueueTokenTraitsQueueEntries({
        client,
        tokenIds: notFoundTokenIds,
      });
    }
    log.info`completed ${doneCount} tokens, skipped ${notFoundTokenIds.length}`;
    await client.query("COMMIT");
    return tokenIds.length;
  });
}

module.exports = watchTokenTraitsQueue;
