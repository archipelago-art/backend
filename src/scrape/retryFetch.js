const fetch = require("node-fetch");

const retry = require("../util/retry");

const FETCH_TIMEOUT_NEEDLE = "network timeout at:";

async function fetchWithRetries(url, fetchOptions = { timeout: 5000 }) {
  const result = await retry(async () => {
    let res;
    try {
      res = await fetch(url, fetchOptions);
      const text = await res
        .text()
        .catch((e) => "failed to read response text");
      const result = { res, text };
      if (res.ok) {
        return { type: "DONE", value: result };
      } else if (res.status >= 500) {
        console.warn(
          "retrying due to server error: %s %s at %s",
          res.status,
          res.statusText,
          url
        );
        return { type: "RETRY", err: result };
      } else {
        console.warn(
          "failing due to client error: %s %s at %s",
          res.status,
          res.statusText,
          url
        );
        return { type: "FATAL", err: result };
      }
    } catch (e) {
      if (
        e instanceof fetch.FetchError &&
        e.message.includes(FETCH_TIMEOUT_NEEDLE)
      ) {
        console.warn("retrying due to timeout:", url);
        return { type: "RETRY", err: e };
      }
      return { type: "FATAL", err: e };
    }
  });
  if (result.type === "FAILED") throw result.err;
  return result.value;
}

module.exports = { fetchWithRetries };
