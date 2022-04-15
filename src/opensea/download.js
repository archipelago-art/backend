const { addRawEvents } = require("../db/opensea/ingestEvents");
const {
  getLastUpdated,
  setLastUpdated,
  getProgress,
} = require("../db/opensea/progress");
const log = require("../util/log")(__filename);
const { initializeArtblocksProgress } = require("./artblocksProgress");
const { fetchEvents } = require("./fetch");

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

async function syncProject({ client, slug, projectId, apiKey }) {
  const lastUpdated = await getLastUpdated({ client, slug, projectId });
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
    log.warn(`got 0 events??? ${slug}`);
  }

  log.info`fast sync: ${numAdded} events for ${slug} (of ${events.length} raw events)`;
}

async function syncAllProjects({ client, apiKey, windowDurationMs }) {
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
};
