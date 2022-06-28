const log = require("../../util/log")(__filename);
const { hexToBuf } = require("../util");

const CONTRACT_ARTBLOCKS_LEGACY = "0x059EDD72Cd353dF5106D2B9cC5ab83a52287aC3a";
const CONTRACT_ARTBLOCKS_STANDARD =
  "0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270";
// Projects below this threshold are legacy, at or above are standard.
const ARTBLOCKS_CONTRACT_THRESHOLD = 3;

async function backfill({ pool, verbose }) {
  const res = await pool.query(
    `
    UPDATE artblocks_projects
    SET token_contract = CASE
        WHEN artblocks_project_index < $1
        THEN ($2::address)
        ELSE ($3::address)
      END
    `,
    [
      ARTBLOCKS_CONTRACT_THRESHOLD,
      hexToBuf(CONTRACT_ARTBLOCKS_LEGACY),
      hexToBuf(CONTRACT_ARTBLOCKS_STANDARD),
    ]
  );
  if (verbose) {
    log.info`Updated ${res.rowCount} projects`;
  }
}

module.exports = backfill;
