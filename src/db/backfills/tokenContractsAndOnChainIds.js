const artblocks = require("../artblocks");
const { hexToBuf } = require("../util");

async function backfillTokenContractsAndOnChainIds({ pool, verbose }) {
  const projectsRes = await pool.query(
    `
    UPDATE projects
    SET token_contract = (CASE WHEN project_id < $1 THEN $2::address ELSE $3::address END)
    WHERE token_contract IS NULL
    `,
    [
      artblocks.ARTBLOCKS_CONTRACT_THRESHOLD,
      hexToBuf(artblocks.CONTRACT_ARTBLOCKS_LEGACY),
      hexToBuf(artblocks.CONTRACT_ARTBLOCKS_STANDARD),
    ]
  );
  if (verbose) {
    console.log("updated %s projects", projectsRes.rowCount);
  }

  const tokensRes = await pool.query(
    `
    UPDATE tokens
    SET
      token_contract = (CASE WHEN project_id < $1 THEN $2::address ELSE $3::address END),
      on_chain_token_id = token_id::uint256
    WHERE
      token_contract IS NULL
      OR on_chain_token_id IS NULL
    `,
    [
      artblocks.ARTBLOCKS_CONTRACT_THRESHOLD,
      hexToBuf(artblocks.CONTRACT_ARTBLOCKS_LEGACY),
      hexToBuf(artblocks.CONTRACT_ARTBLOCKS_STANDARD),
    ]
  );
  if (verbose) {
    console.log("updated %s tokens", tokensRes.rowCount);
  }

  const traitMembersRes = await pool.query(
    `
    UPDATE trait_members
    SET
      token_contract = (CASE WHEN token_id < $1 THEN $2::address ELSE $3::address END),
      on_chain_token_id = token_id::uint256
    WHERE
      token_contract IS NULL
      OR on_chain_token_id IS NULL
    `,
    [
      artblocks.ARTBLOCKS_CONTRACT_THRESHOLD * artblocks.PROJECT_STRIDE,
      hexToBuf(artblocks.CONTRACT_ARTBLOCKS_LEGACY),
      hexToBuf(artblocks.CONTRACT_ARTBLOCKS_STANDARD),
    ]
  );
  if (verbose) {
    console.log("updated %s trait memberships", traitMembersRes.rowCount);
  }
}

module.exports = backfillTokenContractsAndOnChainIds;
