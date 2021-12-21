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

module.exports = {
  fetchEventPage,
};
