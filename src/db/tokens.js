const { hexToBuf } = require("./util");

// tokens is an array of {address, tokenId} objects.
// type TokenSummary = {
//   name: string, // e.g. "Chromie Squiggle"
//   slug: string, // e.g. "chromie-squiggle"
//   imageTemplate: string, // e.g. "{baseUrl}/artbocks/{sz}/0/{hi}/{lo}"
//   tokenIndex: number, // e.g. 7583
//   artistName: string, // e.g. "Snowfro"
//   aspectRatio: number, // e.g. 1.5
// }
async function tokenSummariesByOnChainId({ client, tokens }) {
  const res = await client.query(
    `
    SELECT
      name,
      slug,
      image_template AS "imageTemplate",
      token_index AS "tokenIndex",
      artist_name AS "artistName",
      aspect_ratio AS "aspectRatio"
    FROM tokens
    JOIN
      unnest($1::address[], $2::uint256[])
      AS needles(token_contract, on_chain_token_id)
      USING (token_contract, on_chain_token_id)
    JOIN projects USING (project_id)
    ORDER BY tokens.token_contract, tokens.on_chain_token_id
    `,
    [tokens.map((t) => hexToBuf(t.address)), tokens.map((t) => t.tokenId)]
  );
  return res.rows;
}

module.exports = { tokenSummariesByOnChainId };
