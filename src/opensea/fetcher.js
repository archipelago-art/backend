const { fetchEventsByTypes } = require("./fetch");
const { addEvents, getLastUpdated, setLastUpdated } = require("../db/opensea");

const ONE_MONTH = 1000 * 60 * 60 * 24 * 30;
const LATE_EVENT_SAFETY_MARGIN = 1000 * 60 * 3;

/**
 * Fetch events for a given collection slug (e.g. fidenza-by-tyler-hobbs)
 * slugStartTime should be a JS date with the creation time for the collection,
 * as an initial starting point for event scanning if we haven't searched yet.
 * windowDurationMs is the size of the event scanning window in miliseconds.
 * Returns true if we are up-to-date for this collection, or false otherwise.
 */
async function processEventsWindow({
  client,
  slug,
  slugStartTime,
  windowDurationMs = ONE_MONTH,
  apiKey,
  logEachRequest = false,
}) {
  const since = (await getLastUpdated({ client, slug })) || slugStartTime;
  const windowEnd = new Date(+since + windowDurationMs);
  const events = await fetchEventsByTypes({
    source: { slug },
    since,
    until: windowEnd,
    apiKey,
    eventTypes: ["successful", "created", "transfer", "cancelled"],
    logEachRequest,
  });
  const strippedEvents = events.map(stripEvent);
  await addEvents({ client, events: strippedEvents });
  console.log(
    `${slug}: added ${
      strippedEvents.length
    } events in window ending ${windowEnd.toISOString()}`
  );
  if (windowEnd > Date.now()) {
    // If we've made it up to the present time, we record the latest scan as a few minutes ago,
    // because "late" events sometimes make it into the opensea database (due to block propagation
    // time)
    const until = new Date(Date.now() - LATE_EVENT_SAFETY_MARGIN);
    await setLastUpdated({ client, slug, until });
    return true;
  } else {
    // Subtract 1 second from the window end to make sure that if there are any events on the boundary,
    // we will get all of them on the next scan. (Picking up some duplicate events is fine, skipping
    // events is bad.)
    const until = new Date(+windowEnd - 1000);
    await setLastUpdated({ client, slug, until });
    return false;
  }
}

async function processOpenseaCollection({
  client,
  slug,
  slugStartTime,
  windowDurationMs,
  apiKey,
  logEachRequest = false,
}) {
  const args = {
    client,
    slug,
    slugStartTime,
    windowDurationMs,
    apiKey,
    logEachRequest,
  };
  while (!(await processEventsWindow(args)));
}

function stripEvent(ev) {
  const newAsset = {
    token_id: ev.asset.token_id,
    address: ev.asset.asset_contract.address,
  };
  ev.asset = newAsset;
  return ev;
}

module.exports = { processOpenseaCollection };
