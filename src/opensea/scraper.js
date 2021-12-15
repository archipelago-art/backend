const fetch = require("node-fetch");

const EVENTS_URL = "https://api.opensea.io/api/v1/events";

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
async function fetchEvents({ source, since, until, pageSize = 300 }) {
  const baseParams = {
    only_opensea: false,
    limit: pageSize,
  };
  if (source.contract != null) {
    baseParams.asset_contract_address = source.contract;
  }
  if (source.slug != null) {
    baseParams.collection_slug = source.slug;
  }
  if (since != null) {
    baseParams.occurred_after = Math.floor(since / 1000);
  }
  if (until != null) {
    baseParams.occurred_before = Math.floor(until / 1000);
  }

  const results = [];
  let offset = 0;
  while (true) {
    const params = { ...baseParams, offset };
    const url = `${EVENTS_URL}?${String(new URLSearchParams(params))}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch((e) => "<read failed>");
      throw new Error(`${url}: HTTP ${res.status} ${res.statusText}: ${body}`);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `${url}: invalid JSON: ${e.message}: ${JSON.stringify(text)}`
      );
    }
    if (typeof json !== "object") {
      throw new Error(`${url}: unexpected response: ${JSON.stringify(json)}`);
    }
    if (json.success == false) {
      throw new Error(`${url}: failure: ${JSON.stringify(json)}`);
    }
    if (!Array.isArray(json.asset_events)) {
      throw new Error(`${url}: missing asset_events: ${JSON.stringify(json)}`);
    }
    const events = json.asset_events;
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

/**
 * Fetches OpenSea events according to the given config, and calls the
 * `handleEvent` callback on each new event as it arrives.
 *
 * The config's `collectionSlugs` method is called on *each* iteration
 * of the poll loop to determine the collections to poll for that loop.
 *
 * The `lookbackMs` parameter works around lossy behavior in the OpenSea API
 * with small poll intervals, wherein events can be newly added to the stream
 * with timestamps in the past (off by 30 seconds or so). To see those events
 * at all, we extend the leading edge of the time window by `lookbackMs`
 * milliseconds. A value of `60000` (60 seconds) seems to work okay.
 */
async function streamEvents({
  config,
  pollMs,
  lookbackMs,
  handleEvent,
  pageSize = 300,
}) {
  if (typeof pollMs !== "number") {
    throw new Error(`pollMs: ${pollMs}`);
  }
  if (typeof lookbackMs !== "number") {
    throw new Error(`lookbackMs: ${lookbackMs}`);
  }

  let lastEventIds = new Set();
  let since = new Date();
  while (true) {
    const until = new Date();

    const sources = config.collectionSlugs().map((slug) => ({ slug }));
    const events = [].concat(
      ...(await Promise.all(
        sources.map((source) => {
          return fetchEvents({
            source,
            since: new Date(+since - lookbackMs),
            until,
          }).catch((e) => {
            console.error(
              `failed to fetch events for ${JSON.stringify(source)}: ${e}`
            );
            return [];
          });
        })
      ))
    );

    const newEventIds = new Set();
    for (const event of events) {
      newEventIds.add(event.id);
      if (lastEventIds.has(event.id)) continue;
      try {
        handleEvent(event);
      } catch (e) {
        console.error(`failed to handle ${describeEvent(event)}: ${e}`);
      }
    }
    lastEventIds = newEventIds;
    since = until;
    await sleep(pollMs);
  }
}

function describeEvent(e) {
  if (typeof e !== "object") return `event ${e}`;
  const id = e.id || "?";
  const type = e.event_type || "<unknown event type>";
  const name = (e.asset || {}).name || "<unknown asset>";
  const when = e.created_date || "<unknown date>";
  return `event ${id} ("${name}" ${type} @ ${when})`;
}

async function sleep(ms) {
  return new Promise((res) => {
    setTimeout(() => res(), ms);
  });
}

module.exports = { fetchEvents, streamEvents };
