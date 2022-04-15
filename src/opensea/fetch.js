const nodeFetch = require("node-fetch");
const C = require("../util/combo");
const log = require("../util/log")(__filename);
const { fetchWithRetries } = require("../scrape/retryFetch");

const HACKY_OPENSEA_FETCH_DELAY_MS = 1000;

async function fetchUrl(baseUrl, urlParams, apiKey) {
  const url = `${baseUrl}?${String(urlParams)}`;
  const headers = { "X-API-KEY": apiKey };
  log.debug`fetching ${url}`;
  const promisedSleep = sleepMs(HACKY_OPENSEA_FETCH_DELAY_MS);

  try {
    const { text, res } = await fetchWithRetries(url, {
      headers,
      timeout: 10000,
    });
    const json = JSON.parse(text);
    await promisedSleep;
    return json;
  } catch (e) {
    // I would actually rather see an error if we hit 404s.
    // Keeping this snippet for future reference.
    // if (e.res && e.res.status === 404) return null;
    throw e;
  }
}

const EVENTS_URL = "https://api.opensea.io/api/v1/events";
const eventResponse = C.object({
  next: C.orElse([C.string, C.null_]),
  asset_events: C.array(C.raw),
});
async function fetchEventPage({
  source,
  since,
  until,
  pageSize = 300,
  cursor,
  apiKey,
  tokenId,
  eventType,
}) {
  const params = {
    only_opensea: false,
    limit: pageSize,
  };
  if (cursor != null) {
    params.cursor = cursor;
  }
  if (source.contract != null) {
    params.asset_contract_address = source.contract;
  }
  if (source.slug != null) {
    params.collection_slug = source.slug;
  }
  if (tokenId != null) {
    params.token_id = tokenId;
  }
  if (eventType != null) {
    params.event_type = eventType;
  }

  const json = await fetchUrl(EVENTS_URL, new URLSearchParams(params), apiKey);
  const parsed = eventResponse.parseOrThrow(json);
  return { events: parsed.asset_events, nextCursor: parsed.next };
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
 * Args: `source` should be either `{ contract }` or `{ slug }`; since should be a
 * JS Date, or null
 */
async function _fetchEvents({
  source,
  pageSize = 300,
  apiKey,
  tokenId,
  since,
  eventType,
}) {
  const results = [];
  let cursor = null;
  while (true) {
    const { events, nextCursor } = await fetchEventPage({
      source,
      pageSize,
      cursor,
      apiKey,
      tokenId,
      eventType,
    });
    results.push(...events);
    if (nextCursor == null) {
      break;
    } else {
      cursor = nextCursor;
    }
    if (since && events.length > 0) {
      const lastEvent = events[events.length - 1];
      if (new Date(lastEvent.created_date) < since) {
        log.debug`done scanning: event created: ${new Date(
          lastEvent.created_date
        )} vs since: ${since}`;
        break;
      }
    }
  }
  return results;
}

/**
 * Fetch events of the created, successful, and cancelled types.
 * This avoids fetching bids, which is important due to the massive spamminess
 * of OS bids. We return the events along with the time when we started the
 * fetch. Since we do three separate fetches, we might get some events from
 * after the start time, but we should treat the fetch start time as the last
 * update time, lest we risk missing some events for the first fetch to finish.
 */
async function fetchEvents({ source, pageSize = 300, apiKey, tokenId, since }) {
  const updateTimestamp = new Date();
  const created = await _fetchEvents({
    source,
    pageSize,
    apiKey,
    tokenId,
    since,
    eventType: "created",
  });
  const successful = await _fetchEvents({
    source,
    pageSize,
    apiKey,
    tokenId,
    since,
    eventType: "successful",
  });
  const cancelled = await _fetchEvents({
    source,
    pageSize,
    apiKey,
    tokenId,
    since,
    eventType: "cancelled",
  });
  const events = [...created, ...successful, ...cancelled];
  events.sort((a, b) => +new Date(b.created_date) - +new Date(a.created_date));
  return { events, updateTimestamp };
}

const ASSETS_URL = "https://api.opensea.io/api/v1/assets";
const assetsResponse = C.object({ assets: C.array(C.raw) });
const MAX_TOKEN_IDS_PER_QUERY = 20;
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
  const assets = parsed.assets;
  if (assets.length !== tokenIds.length) {
    const assetIds = assets.map((x) => x.token_id);
    const missingIds = new Set(tokenIds.map((x) => String(x)));
    for (const a of assetIds) {
      missingIds.delete(a);
    }
    for (const m of missingIds) {
      log.warn`Could not find OpenSea asset for artblocks tokens with id: ${m}`;
    }
  }
  return assets;
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
  fetchAssetsPage,
  fetchAssets,
};
