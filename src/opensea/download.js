const { addRawEvents } = require("../db/opensea/ingestEvents");
const {
  getLastUpdated,
  setLastUpdated,
  getProgress,
} = require("../db/opensea/progress");
const log = require("../util/log")(__filename);
const { initializeArtblocksProgress } = require("./artblocksProgress");
const { fetchEvents, fetchListings } = require("./fetch");
const { bufToAddress } = require("../db/util");

async function downloadEventsForTokens({ client, tokenSpecs, apiKey }) {
  for (const { contract, onChainTokenId, slug, tokenIndex } of tokenSpecs) {
    const { events } = await fetchEvents({
      source: { contract },
      apiKey,
      tokenId: onChainTokenId,
    });

    const strippedEvents = events
      .filter((x) => x.asset != null)
      .filter(
        (x) =>
          x.event_type === "created" ||
          x.event_type === "successful" ||
          x.event_type === "cancelled"
      )
      .map(stripEvent);
    if (log.debug.isEnabled()) {
      for (const event of strippedEvents) {
        const type = event.event_type;
        const id = event.id;
        const time = event.listing_time;
        log.debug`event: ${slug} #${tokenIndex}: type=${type}, id=${id}, listing_time=${time}`;
      }
    }
    const added = await addRawEvents({ client, events: strippedEvents });
    if (added > 0) {
      log.info`Added ${added}/${strippedEvents.length} for ${slug} #${tokenIndex}`;
    } else {
      log.info`No new events for ${slug} #${tokenIndex}`;
    }
  }
}

async function removeDroppedAsks({ client, tokenId, apiKey }) {
  const res1 = await client.query(
    `
    SELECT
      on_chain_token_id AS "onChainTokenId",
      tokens.token_contract AS "contractAddress",
      slug,
      token_index AS "tokenIndex"
    FROM tokens JOIN projects USING (project_id)
    WHERE token_id=$1
    `,
    [tokenId]
  );
  if (res1.rows.length !== 1) {
    throw new Error("can't find token, bad slug?");
  }
  let { onChainTokenId, contractAddress, slug, tokenIndex } = res1.rows[0];
  contractAddress = bufToAddress(contractAddress);
  const res2 = await client.query(
    `
    SELECT event_id AS id, listing_time AS "listingTime", price
    FROM opensea_asks
    WHERE token_id=$1 AND active
    `,
    [tokenId]
  );
  const asks = res2.rows;
  let listingsResponse;
  try {
    listingsResponse = await fetchListings({
      contractAddress,
      onChainTokenId,
      apiKey,
    });
  } catch (e) {
    log.warn`Failed to get listings for ${slug} #${tokenIndex}: ${JSON.stringify(
      e
    )}}`;
    return;
  }
  const validPrices = new Set();
  const { listings: legacyListings, seaport_listings: seaportListings } =
    listingsResponse;
  for (const { base_price: price } of legacyListings) {
    validPrices.add(price);
  }
  for (const { current_price: price } of seaportListings) {
    validPrices.add(price);
  }
  const droppedAsks = asks.filter((x) => !validPrices.has(x.price));
  for (const { id, listingTime, price } of droppedAsks) {
    const displayPrice = Number(BigInt(price) / 10n ** 16n) / 100;
    log.info`dropping ${id}, for ${slug} #${tokenIndex}, price ${displayPrice}, listed ${listingTime}`;
  }
  await client.query(
    `
    UPDATE opensea_asks
    SET active = false
    WHERE event_id=ANY($1::text[])
    `,
    [droppedAsks.map((x) => x.id)]
  );
}

async function tokensWithAsks({ client, slug }) {
  const res = await client.query(
    `
    SELECT DISTINCT token_id AS id
    FROM opensea_asks
    JOIN projects USING (project_id)
    WHERE active AND (slug=$1 OR $1 IS NULL)
    `,
    [slug]
  );
  return res.rows.map((x) => x.id);
}

async function removeAllDroppedAsks({ client, apiKey, slug }) {
  const tokensToCheck = await tokensWithAsks({ client, slug });
  for (const tokenId of tokensToCheck) {
    await removeDroppedAsks({ client, tokenId, apiKey });
  }
}

async function syncProject({ client, slug, projectId, apiKey }) {
  const lastUpdated = await getLastUpdated({ client, projectId });
  const { events, updateTimestamp } = await fetchEvents({
    source: { slug },
    apiKey,
    since: lastUpdated,
  });
  const relevantEvents = events.filter(
    (x) =>
      x.event_type === "created" ||
      x.event_type === "successful" ||
      x.event_type === "cancelled"
  );
  const strippedEvents = relevantEvents
    .filter((x) => x.asset != null)
    .map(stripEvent);
  const numAdded = await addRawEvents({ client, events: strippedEvents });
  if (events.length > 0) {
    // Important: only setLastUpdated after getting all of the events since
    // last update time, otherwise we might have "gaps". This means that
    // downloading all events since last update is a oneshot. If this becomes a
    // problem, we can write another method that gets events in past windows.
    await setLastUpdated({
      client,
      slug,
      until: updateTimestamp,
      projectId,
    });
  } else {
    log.warn`got 0 events??? ${slug}`;
  }

  log.info`fast sync: ${numAdded} events for ${slug} (of ${events.length} raw events)`;
}

async function syncAllProjects({ client, apiKey }) {
  await initializeArtblocksProgress({ client, apiKey });
  const progress = await getProgress({ client });
  for (const { slug, projectId } of progress) {
    await syncProject({ client, slug, projectId, apiKey });
  }
}

function stripEvent(ev) {
  const newAsset = {
    token_id: ev.asset.token_id,
    address: ev.asset.asset_contract.address,
  };
  ev.asset = newAsset;
  return ev;
}

module.exports = {
  syncProject,
  syncAllProjects,
  downloadEventsForTokens,
  removeDroppedAsks,
  removeAllDroppedAsks,
  tokensWithAsks,
};
