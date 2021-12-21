const nodeFetch = require("node-fetch");
const C = require("../util/combo");

async function fetchUrl(baseUrl, urlParams, apiKey) {
  const url = `${baseUrl}?${String(urlParams)}`;
  const headers = { "X-API-KEY": apiKey };
  console.log(`Opensea: fetching ${url}`);
  const res = await nodeFetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${url}`);
  }
  return await res.json();
}

const EVENTS_URL = "https://api.opensea.io/api/v1/events";
const eventResponse = C.object({ asset_events: C.array(C.raw) });
async function fetchEventPage({
  source,
  since,
  until,
  pageSize = 300,
  offset,
  apiKey,
  eventType,
}) {
  const params = {
    only_opensea: false,
    limit: pageSize,
    offset,
  };
  if (source.contract != null) {
    params.asset_contract_address = source.contract;
  }
  if (source.slug != null) {
    params.collection_slug = source.slug;
  }
  if (since != null) {
    params.occurred_after = Math.floor(since / 1000);
  }
  if (until != null) {
    params.occurred_before = Math.floor(until / 1000);
  }
  if (eventType != null) {
    params.event_type = eventType;
  }

  const json = await fetchUrl(EVENTS_URL, new URLSearchParams(params), apiKey);
  const parsed = eventResponse.parseOrThrow(json);
  return parsed.asset_events;
}

/**
 * Fetches all OpenSea events matching the given query filters, and returns
 * them in an array. Elements of the result array are objects with lots of
 * fields, typically including:
 *
 *    - `event_id`, a number (stable across requests for the same event)
 *    - `event_type`, a string like `"created"` or `"offer_entered"`
 *    - `asset.token_id`, a numeric string like `"40000342"`
 *
 * OpenSea docs: <https://docs.opensea.io/reference/retrieving-asset-events>.
 *
 * Args: `source` should be either `{ contract }` or `{ slug }`; `since` and
 * `until` should be `Date` objects or `null`.
 */
async function fetchEvents({
  source,
  since,
  until,
  pageSize = 300,
  apiKey,
  eventType,
}) {
  const results = [];
  let offset = 0;
  while (true) {
    const events = await fetchEventPage({
      source,
      since,
      until,
      pageSize,
      offset,
      apiKey,
      eventType,
    });
    results.push(...events);
    if (events.length < pageSize) {
      break;
    } else {
      offset += events.length;
    }
  }

  results.sort((a, b) => {
    const ta = a.created_date;
    const tb = b.created_date;
    return ta > tb ? 1 : ta < tb ? -1 : 0;
  });

  return results;
}

async function fetchEventsByTypes({
  source,
  since,
  until,
  pageSize = 300,
  apiKey,
  eventTypes,
}) {
  const results = [];
  for (const eventType of eventTypes) {
    const subResults = await fetchEvents({
      source,
      since,
      until,
      pageSize,
      apiKey,
      eventType,
    });
    results.push(...subResults);
  }
  results.sort((a, b) => {
    const ta = a.created_date;
    const tb = b.created_date;
    return ta > tb ? 1 : ta < tb ? -1 : 0;
  });

  return results;
}

module.exports = {
  fetchEventPage,
  fetchEvents,
  fetchEventsByTypes,
};
