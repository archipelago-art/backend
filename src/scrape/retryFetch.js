const fetch = require("node-fetch");

const retry = require("../util/retry");

const FETCH_TIMEOUT_NEEDLE = "network timeout at:";

async function fetchWithRetries(url, fetchOptions = { timeout: 5000 }) {
  const result = await retry(async () => {
    let res;
    try {
      res = await fetch(url, fetchOptions);
      const text = await res.text();
      return { type: "DONE", value: { text, res } };
    } catch (e) {
      if (
        e instanceof fetch.FetchError &&
        e.message.includes(FETCH_TIMEOUT_NEEDLE)
      ) {
        console.warn("retrying due to timeout:", url);
        return { type: "RETRY", err: e };
      }
      if (res && res.status >= 500) {
        console.warn("retrying due to server error:", url);
        return { type: "RETRY", err: e };
      }
      return { type: "FATAL", err: e };
    }
  });
  if (result.type === "FAILED") throw result.err;
  return result.value;
}

module.exports = { fetchWithRetries };
