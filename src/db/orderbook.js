const { ObjectType, newId } = require("./id");
const { hexToBuf } = require("./util");

/**
 * type Scope = ProjectScope | TokenScope | TraitScope | CnfScope;
 * type ProjectScope = {type: "PROJECT", projectId}
 * type TokenScope = {type: "TOKEN", tokenId}
 * type TraitScope = {type: "TRAIT", traitId}
 * type CnfScope = empty; // not yet implemented
 */
async function addBid({
  client,
  scope /*: Scope */,
  price /*: ethers.BigNumber */,
  deadline /*: Date */,
  bidder /*: address */,
  nonce /*: uint256 */,
  agreement /*: bytes: ABI-encoded [OrderAgreement] */,
  message /*: bytes: ABI-encoded [Bid] */,
  signature /*: bytes65 */,
}) {
  await client.query("BEGIN");
  let projectId, scopeId;
  switch (scope.type) {
    case "PROJECT":
      await checkProjectExists(client, scope.projectId);
      projectId = scope.projectId;
      scopeId = projectId;
      break;
    case "TOKEN":
      projectId = await projectForTokenId(client, scope.tokenId);
      scopeId = scope.tokenId;
      break;
    case "TRAIT":
      projectId = await projectForTraitId(client, scope.traitId);
      scopeId = scope.traitId;
      break;
    case "CNF":
      throw new Error("CNF scopes not implemented");
      break;
    default:
      throw new Error(`Unrecognized scope type: ${scope.type}`);
  }
  const bidId = newId(ObjectType.BID);
  await client.query(
    `
    INSERT INTO bids (
      bid_id,
      project_id,
      scope,
      active,
      price,
      deadline,
      create_time,
      bidder,
      nonce,
      agreement,
      message,
      signature
    ) VALUES (
      $1::bidid,
      $2::projectid,
      $3::bidscope,
      true,
      $4::uint256,
      $5::timestamptz,
      now(),
      $6::address,
      $7::uint256,
      $8::bytea,
      $9::bytea,
      $10::signature
    )
    `,
    [
      bidId,
      projectId,
      scopeId,
      String(price),
      deadline,
      hexToBuf(bidder),
      String(nonce),
      hexToBuf(agreement),
      hexToBuf(message),
      hexToBuf(signature),
    ]
  );
  await client.query("COMMIT");
  return bidId;
}

async function addAsk({
  client,
  tokenId /*: tokenid */,
  price /*: ethers.BigNumber */,
  deadline /*: Date */,
  asker /*: address */,
  nonce /*: uint256 */,
  agreement /*: bytes: ABI-encoded [OrderAgreement] */,
  message /*: bytes: ABI-encoded [Bid] */,
  signature /*: bytes65 */,
}) {
  await client.query("BEGIN");
  const projectId = await projectForTokenId(client, tokenId);
  const askId = newId(ObjectType.ASK);
  await client.query(
    `
    INSERT INTO asks (
      ask_id,
      project_id,
      token_id,
      active,
      price,
      deadline,
      create_time,
      asker,
      nonce,
      agreement,
      message,
      signature
    ) VALUES (
      $1::askid,
      $2::projectid,
      $3::tokenid,
      true,
      $4::uint256,
      $5::timestamptz,
      now(),
      $6::address,
      $7::uint256,
      $8::bytea,
      $9::bytea,
      $10::signature
    )
    `,
    [
      askId,
      projectId,
      tokenId,
      String(price),
      deadline,
      hexToBuf(asker),
      String(nonce),
      hexToBuf(agreement),
      hexToBuf(message),
      hexToBuf(signature),
    ]
  );
  await client.query("COMMIT");
  return askId;
}

async function checkProjectExists(client, projectId) {
  const res = await client.query(
    `
    SELECT 1 FROM projects WHERE project_id = $1
    `,
    [projectId]
  );
  if (res.rows.length !== 1) throw new Error(`no such project: ${projectId}`);
}

async function projectForTokenId(client, tokenId) {
  const res = await client.query(
    `
    SELECT project_id AS "id" FROM tokens WHERE token_id = $1
    `,
    [tokenId]
  );
  if (res.rows.length !== 1) throw new Error(`no such token: ${tokenId}`);
  return res.rows[0].id;
}

async function projectForTraitId(client, traitId) {
  const res = await client.query(
    `
    SELECT project_id AS "id"
    FROM traits JOIN features USING (feature_id)
    WHERE trait_id = $1
    `,
    [traitId]
  );
  if (res.rows.length !== 1) throw new Error(`no such trait: ${traitId}`);
  return res.rows[0].id;
}

module.exports = {
  addBid,
  addAsk,
};