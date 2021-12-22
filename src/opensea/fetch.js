const nodeFetch = require("node-fetch");
const C = require("../util/combo");

const HACKY_OPENSEA_FETCH_DELAY_MS = 1000;

async function fetchUrl(baseUrl, urlParams, apiKey) {
  const url = `${baseUrl}?${String(urlParams)}`;
  const headers = { "X-API-KEY": apiKey };
  console.log(`Opensea: fetching ${url}`);
  const res = await nodeFetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${url}`);
  }
  const json = await res.json();
  await sleepMs(HACKY_OPENSEA_FETCH_DELAY_MS);
  return json;
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

const ASSETS_URL = "https://api.opensea.io/api/v1/assets";
const assetsResponse = C.object({ assets: C.array(C.raw) });
const MAX_TOKEN_IDS_PER_QUERY = 30;
async function fetchAssetsPage({ contractAddress, tokenIds, apiKey }) {
  if (tokenIds.length > MAX_TOKEN_IDS_PER_QUERY) {
    throw new Error("too many tokenIds");
  }
  const params = new URLSearchParams({
    asset_contract_address: contractAddress,
  });
  for (const tokenId of tokenIds) {
    params.append("token_ids", tokenId);
  }
  const json = await fetchUrl(ASSETS_URL, params, apiKey);
  const parsed = assetsResponse.parseOrThrow(json);
  return parsed.assets;
}

async function fetchAssets({ contractAddress, tokenIds, apiKey }) {
  const results = [];
  let offset = 0;
  while (offset < tokenIds.length) {
    const theseIds = tokenIds.slice(offset, offset + MAX_TOKEN_IDS_PER_QUERY);
    const theseAssets = await fetchAssetsPage({
      contractAddress,
      tokenIds: theseIds,
      apiKey,
    });
    results.push(...theseAssets);
    offset += MAX_TOKEN_IDS_PER_QUERY;
  }
  return results;
}

async function sleepMs(ms) {
  await new Promise((res) => void setTimeout(res, ms));
}

module.exports = {
  fetchEventPage,
  fetchEvents,
  fetchEventsByTypes,
  fetchAssetsPage,
  fetchAssets,
};
