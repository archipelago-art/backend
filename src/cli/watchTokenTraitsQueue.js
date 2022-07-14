const artblocks = require("../db/artblocks");
const channels = require("../db/channels");
const tokens = require("../db/tokens");
const { acqrel, withPool } = require("../db/util");
const { fetchTokenData } = require("../scrape/fetchArtblocksToken");
const log = require("../util/log")(__filename);
const signal = require("../util/signal");

const BATCH_SIZE = 64;
const WAIT_DURATION_SECONDS = 60;

// If we fail to fetch a token, don't re-fetch data *for that specific token* for this long.
const FAILED_FETCH_DELAY_SECONDS = 30;

class ExpirationCache /*:: <T> */ {
  constructor() {
    this._items /*: Array<[number, T]> */ = [];
  }
  add(item, expirationTime) {
    this._items.push([expirationTime, item]);
  }
  expire(expirationTime = Date.now()) {
    this._items = this._items.filter((kv) => kv[0] > expirationTime);
  }
  getAll() {
    return this._items.map((kv) => kv[1]);
  }
}

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

      const ecache /*: ExpirationCache<TokenId> */ = new ExpirationCache();
      while (true) {
        try {
          const n = await watchTokenTraitsQueueOnce(pool, ecache);
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

async function watchTokenTraitsQueueOnce(pool, ecache) {
  return await acqrel(pool, async (client) => {
    await client.query("BEGIN");
    ecache.expire();
    const excludeTokenIds = ecache.getAll();
    const tokenIds = await tokens.claimTokenTraitsQueueEntries({
      client,
      limit: BATCH_SIZE,
      excludeTokenIds,
      alreadyInTransaction: true,
    });
    log.info`got ${tokenIds.length} token IDs to process (limit:${BATCH_SIZE}, exclude:${excludeTokenIds.length})`;
    if (tokenIds.length === 0) {
      await client.query("COMMIT");
      return 0;
    }
    const artblocksTokenIds = await artblocks.getArtblocksTokenIds({
      client,
      tokenIds,
    });
    const tokenData = await Promise.all(
      artblocksTokenIds.map(
        async ({ tokenId, artblocksTokenId, tokenContract }) => {
          const token = await fetchTokenData(
            tokenContract,
            artblocksTokenId
          ).catch((e) => {
            log.warn`failed to fetch Art Blocks token #${artblocksTokenId}: ${e}`;
            const expirationTime =
              Date.now() + FAILED_FETCH_DELAY_SECONDS * 1000;
            ecache.add(tokenId, expirationTime);
            return { found: false };
          });
          log.debug`token ${tokenId} (Art Blocks #${artblocksTokenId}): found=${token.found}`;
          if (!token.found) {
            const expirationTime =
              Date.now() + FAILED_FETCH_DELAY_SECONDS * 1000;
            ecache.add(tokenId, expirationTime);
            return { tokenId, rawTokenData: null };
          }
          return { tokenId, rawTokenData: token.raw };
        }
      )
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
