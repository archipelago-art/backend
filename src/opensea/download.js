const { addRawEvents } = require("../db/opensea/ingestEvents");
const { getLastUpdated, setLastUpdated } = require("../db/opensea/progress");
const log = require("../util/log")(__filename);
const { getProjectSlugs } = require("./collections");
const { fetchEventsByTypes } = require("./fetch");

const ONE_MONTH = 1000 * 60 * 60 * 24 * 30;
const LATE_EVENT_SAFETY_MARGIN = 1000 * 60 * 3;
const BEGINNING_OF_HISTORY = new Date("2020-11-27");

/**
 * Fetch events for a given collection slug (e.g. fidenza-by-tyler-hobbs)
 * If we haven't scanned for this project yet, we'll start at the start of ArtBlocks history,
 * i.e. November 2020.
 * windowDurationMs is the size of the event scanning window in miliseconds.
 * Returns true if we are up-to-date for this collection, or false otherwise.
 */
async function downloadWindow({
  client,
  slug,
  projectId,
  windowDurationMs = ONE_MONTH,
  apiKey,
}) {
  const since =
    (await getLastUpdated({ client, slug, projectId })) || BEGINNING_OF_HISTORY;
  const windowEnd = new Date(+since + windowDurationMs);
  log.info`window: ${since.toISOString()} to ${windowEnd.toISOString()}`;
  const events = await fetchEventsByTypes({
    source: { slug },
    since,
    until: windowEnd,
    apiKey,
    eventTypes: ["successful", "created", "transfer", "cancelled"],
  });
  // Filter for asset != null to skip all the asset bundles, which we don't
  // care about (rare + very difficult to correctly attribute the price to the pieces)
  const strippedEvents = events.filter((x) => x.asset != null).map(stripEvent);
  await addRawEvents({ client, events: strippedEvents });
  log.info`${slug}: added ${
    strippedEvents.length
  } events in window ending ${windowEnd.toISOString()}`;
  if (windowEnd > Date.now()) {
    // If we've made it up to the present time, we record the latest scan as a few minutes ago,
    // because "late" events sometimes make it into the opensea database (due to block propagation
    // time)
    const until = new Date(Date.now() - LATE_EVENT_SAFETY_MARGIN);
    await setLastUpdated({ client, slug, until, projectId });
    return true;
  } else {
    // Subtract 1 second from the window end to make sure that if there are any events on the boundary,
    // we will get all of them on the next scan. (Picking up some duplicate events is fine, skipping
    // events is bad.)
    const until = new Date(+windowEnd - 1000);
    await setLastUpdated({ client, slug, until, projectId });
    return false;
  }
}

async function downloadEventsForTokens({ client, tokenSpecs, apiKey }) {
  for (const { contract, onChainId } of tokenSpecs) {
    const events = await fetchEventsByTypes({
      source: { contract },
      eventTypes: ["successful", "created", "transfer", "cancelled"],
      apiKey,
      tokenId: onChainId,
    });
    const strippedEvents = events
      .filter((x) => x.asset != null)
      .map(stripEvent);
    const added = await addRawEvents({ client, events: strippedEvents });
    log.info`Added ${added}/${strippedEvents.length} for ${contract}/${onChainId}`;
  }
}

async function downloadCollection({
  client,
  slug,
  projectId,
  windowDurationMs,
  apiKey,
}) {
  const args = {
    client,
    slug,
    projectId,
    windowDurationMs,
    apiKey,
  };
  while (!(await downloadWindow(args)));
}

async function downloadAllCollections({ client, apiKey, windowDurationMs }) {
  const projectSlugs = await getProjectSlugs({ client, apiKey });
  const neverLoaded = [];
  const toUpdate = [];
  // This is hacky because we make O(|slugs|) DB calls but we could just
  // as well have a single query. Unlikely to be a real performance issue
  // in practice.
  for (const { slug, projectId } of projectSlugs) {
    const lastUpdated = await getLastUpdated({ client, slug, projectId });
    if (lastUpdated == null) {
      neverLoaded.push({ slug, projectId });
    } else {
      toUpdate.push({ slug, projectId });
    }
  }
  // Prioritize collections for which we have no data.
  // This is helpful if we're restarting the ingestion job, we don't need to
  // wait for it to load 100 mostly-finished projects before it starts getting
  // new data.
  // It will still get around to every collection eventually.
  for (const { slug, projectId } of neverLoaded) {
    log.info`=== ingesting opensea events for ${slug} ===`;
    await downloadCollection({
      client,
      slug,
      projectId,
      apiKey,
      windowDurationMs,
    });
  }
  for (const { slug, projectId } of toUpdate) {
    log.info`=== ingesting opensea events for ${slug} ===`;
    await downloadCollection({
      client,
      slug,
      projectId,
      apiKey,
      windowDurationMs,
    });
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
  downloadCollection,
  downloadAllCollections,
  downloadEventsForTokens,
};
