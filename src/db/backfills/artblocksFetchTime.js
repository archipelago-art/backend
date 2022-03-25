const log = require("../../util/log")(__filename);

async function backfillArtblocksFetchTime({ pool, verbose }) {
  const res = await pool.query(
    `
    UPDATE artblocks_tokens
    SET fetch_time = tokens.fetch_time
    FROM tokens
    WHERE artblocks_tokens.token_id = tokens.token_id
    `
  );
  if (verbose) {
    log.info`updated ${res.rowCount} artblocks tokens`;
  }
}

module.exports = backfillArtblocksFetchTime;
