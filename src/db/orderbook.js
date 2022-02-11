const ethers = require("ethers");
const { ObjectType, newId } = require("./id");
const { hexToBuf, bufToAddress } = require("./util");

/**
 * type Scope = ProjectScope | TokenScope | TraitScope | CnfScope;
 * type ProjectScope = {type: "PROJECT", projectId}
 * type TokenScope = {type: "TOKEN", tokenId}
 * type TraitScope = {type: "TRAIT", traitId}
 * type CnfScope = {type: "CNF", cnfId}
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
      projectId = await projectForCnfId(client, scope.cnfId);
      scopeId = scope.cnfId;
      break;
    default:
      throw new Error(`Unrecognized scope type: ${scope.type}`);
  }
  await client.query(
    `
    INSERT INTO bidscopes(scope) VALUES($1) ON CONFLICT DO NOTHING
    `,
    [scopeId]
  );
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

async function floorAsk({ client, projectId, tokenId }) {
  if ((projectId == null) == (tokenId == null)) {
    throw new Error("must provide either projectId or tokenId");
  }
  const res = await client.query(
    `
    SELECT
      ask_id AS "askId",
      token_id AS "tokenId",
      price,
      deadline,
      asker
    FROM asks
    WHERE (token_id = $1 OR $1 IS NULL)
      AND (project_id = $2 OR $2 IS NULL)
      AND active
    ORDER BY price ASC, create_time ASC
    LIMIT 1
    `,
    [tokenId, projectId]
  );
  if (res.rows.length === 0) {
    return null;
  }
  const x = res.rows[0];
  return {
    ...x,
    asker: bufToAddress(x.asker),
    price: ethers.BigNumber.from(x.price),
  };
  return res.rows[0];
}

/**
 * Return all active bids that match a token
 */
async function bidIdsForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT bid_id AS "bidId"
    FROM bids
    WHERE active
    AND scope IN (
      SELECT $1::tokenid AS scope
      UNION ALL
      SELECT project_id AS scope FROM tokens WHERE token_id = $1
      UNION ALL
      SELECT trait_id AS scope FROM trait_members WHERE token_id = $1
      UNION ALL
      SELECT cnf_id AS scope FROM cnf_members WHERE token_id = $1
    )
    ORDER BY price DESC, create_time ASC
    `,
    [tokenId]
  );
  return res.rows.map((r) => r.bidId);
}

async function bidDetails({ client, bidIds }) {
  const res = await client.query(
    `
    SELECT bid_id AS "bidId", price, deadline, bidder
    FROM bids
    WHERE bid_id = ANY($1::bidid[])
    `,
    [bidIds]
  );
  return res.rows.map((r) => ({
    bidId: r.bidId,
    price: ethers.BigNumber.from(r.price),
    deadline: r.deadline,
    bidder: bufToAddress(r.bidder),
  }));
}

async function bidDetailsForToken({ client, tokenId }) {
  const bidIds = await bidIdsForToken({ client, tokenId });
  return await bidDetails({ client, bidIds });
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

async function projectForCnfId(client, cnfId) {
  const res = await client.query(
    `
    SELECT project_id AS "id" FROM cnfs WHERE cnf_id = $1
    `,
    [cnfId]
  );
  if (res.rows.length !== 1) throw new Error(`no such CNF: ${cnfId}`);
  return res.rows[0].id;
}

module.exports = {
  addBid,
  addAsk,
  floorAsk,
  bidIdsForToken,
  bidDetails,
  bidDetailsForToken,
};
