const ethers = require("ethers");
const { ObjectType, newId } = require("./id");
const { hexToBuf, bufToAddress } = require("./util");
const { marketEvents } = require("./channels");

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
  let projectId, scopeId, outputScope, slug;

  async function getSlug(projectId) {
    const slugRes = await client.query(
      `
      SELECT slug
      FROM projects
      WHERE project_id = $1
      `,
      [projectId]
    );

    return slugRes.rows[0].slug;
  }

  switch (scope.type) {
    case "PROJECT": {
      await checkProjectExists(client, scope.projectId);
      projectId = scope.projectId;
      scopeId = projectId;
      slug = await getSlug(scope.projectId);
      outputScope = { type: "PROJECT", projectId, slug };
      break;
    }
    case "TOKEN": {
      projectId = await projectForTokenId(client, scope.tokenId);
      scopeId = scope.tokenId;
      const tokenIndexRes = await client.query(
        `
        SELECT token_index as "tokenIndex"
        FROM tokens
        WHERE token_id = $1
        `,
        [scope.tokenId]
      );
      const tokenIndex = tokenIndexRes.rows[0].tokenIndex;
      outputScope = { type: "TOKEN", tokenId: scope.tokenId, tokenIndex };
      break;
    }
    case "TRAIT": {
      projectId = await projectForTraitId(client, scope.traitId);
      scopeId = scope.traitId;
      const traitsRes = await client.query(
        `
          SELECT features.name, traits.value
          FROM traits JOIN features USING (feature_id)
          WHERE trait_id = $1
        `,
        [scope.traitId]
      );
      const { name: featureName, value: traitValue } = traitsRes.rows[0];
      outputScope = {
        type: "TRAIT",
        traitId: scope.traitId,
        featureName,
        traitValue,
      };
      break;
    }
    case "CNF": {
      projectId = await projectForCnfId(client, scope.cnfId);
      scopeId = scope.cnfId;
      outputScope = {
        type: "CNF",
        cnfId: scope.cnfId,
      };
      break;
    }
    default:
      throw new Error(`Unrecognized scope type: ${scope.type}`);
  }
  slug = slug ?? (await getSlug(projectId));

  await client.query(
    `
    INSERT INTO bidscopes(scope) VALUES($1) ON CONFLICT DO NOTHING
    `,
    [scopeId]
  );
  const bidId = newId(ObjectType.BID);
  const insertRes = await client.query(
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
    ) RETURNING create_time AS "createTime"
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
  const { createTime } = insertRes.rows[0];

  const notification = {
    type: "BID_PLACED",
    orderId: bidId,
    projectId,
    slug,
    scope: outputScope,
    venue: "ARCHIPELAGO",
    bidder,
    currency: "ETH",
    price: String(price),
    timestamp: createTime.toISOString(),
    expirationTime: deadline && deadline.toISOString(),
  };
  await marketEvents.send(client, notification);

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

async function askDetails({ client, askIds }) {
  const res = await client.query(
    `
    SELECT ask_id AS "askId", price, deadline, asker, token_id AS "tokenId"
    FROM asks
    WHERE ask_id = ANY($1::askid[])
    `,
    [askIds]
  );
  return res.rows.map((r) => ({
    askId: r.askId,
    price: ethers.BigNumber.from(r.price),
    deadline: r.deadline,
    asker: bufToAddress(r.asker),
    tokenId: r.tokenId,
  }));
}

async function floorAsk({ client, projectId, tokenId }) {
  if ((projectId == null) == (tokenId == null)) {
    throw new Error("must provide either projectId or tokenId");
  }
  const res = await client.query(
    `
    SELECT
      ask_id AS "askId"
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
  return res.rows[0].askId;
}

/**
 * Return {askId, tokenId} objects for every token in the project that has
 * at least one active ask.
 */
async function floorAskIdsForAllTokensInProject({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      ask_id AS "askId",
      token_id AS "tokenId"
    FROM (
      SELECT
        ask_id,
        token_id,
        rank() OVER (
          PARTITION BY token_id
          ORDER BY price ASC, create_time ASC
        ) AS ask_rank
      FROM asks
      WHERE project_id = $1::projectid
        AND active
      ) AS ranked_asks
    WHERE ask_rank = 1
    ORDER BY token_id
    `,
    [projectId]
  );
  return res.rows;
}

/**
 * Return {askId, projectId} objects for every project which has at least one ask.
 * If the project has an ask, the askId will be the lowest ask for that project.
 */
async function floorAskForEveryProject({ client }) {
  const res = await client.query(
    `
    SELECT ask_id AS "askId", project_id AS "projectId"
    FROM (
      SELECT
        ask_id,
        project_id,
        rank() OVER (
          PARTITION BY project_id
          ORDER BY price ASC, create_time ASC
        ) AS ask_rank
      FROM asks
      WHERE active
    ) AS ranked_asks
    WHERE ask_rank = 1
    ORDER BY project_id
    `
  );
  return res.rows;
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

/**
 * Return {tokenId, bidId} pairs for every token in the project.
 * bidId will be null if there is no bid matching that token.
 */
async function highBidIdsForAllTokensInProject({ client, projectId }) {
  // Plan:
  // 1. Find all the distinct scopes relevant to the project.
  // 2. For each scope, find the best bid ID and its price/create_time.
  // 3. For each token, find matching scopes, join, order by rank limit 1.
  await client.query("BEGIN");
  await client.query(
    `
    CREATE TEMPORARY TABLE this_project_id(project_id)
    ON COMMIT DROP
    AS (SELECT $1::projectid)
    `,
    [projectId]
  );
  const res = await client.query(`
    CREATE TEMPORARY TABLE these_scopes(
      scope bidscope PRIMARY KEY
    );
    CREATE TEMPORARY TABLE these_ranked_scopes(
      rank int8 PRIMARY KEY,
      scope bidscope NOT NULL,
      bid_id bidid
    );

    INSERT INTO these_scopes(scope)
      SELECT token_id FROM tokens WHERE project_id = (
        SELECT project_id FROM this_project_id
      )
    UNION ALL
      SELECT project_id FROM this_project_id
    UNION ALL
      SELECT trait_id FROM features JOIN traits USING (feature_id)
      WHERE features.project_id = (
        SELECT project_id FROM this_project_id
      )
    UNION ALL
      SELECT cnf_id FROM cnfs WHERE project_id = (
        SELECT project_id FROM this_project_id
      )
    ;

    INSERT INTO these_ranked_scopes(rank, scope, bid_id)
    SELECT
      rank() OVER (ORDER BY price DESC, create_time ASC),
      scope,
      bid_id
    FROM (
      SELECT
        rank() OVER (
          PARTITION BY scope
          ORDER BY price DESC, create_time ASC
        ) AS bid_rank,
        scope,
        bid_id,
        price,
        create_time
      FROM these_scopes JOIN bids USING (scope)
      WHERE active
    ) AS bids_ranked_by_scope
    WHERE bid_rank = 1
    ;

    SELECT
      token_id AS "tokenId",
      (
        SELECT bid_id FROM these_ranked_scopes
        WHERE scope IN (
          SELECT token_id AS scope
          UNION ALL
          SELECT project_id AS scope
          UNION ALL
          SELECT trait_id AS scope FROM trait_members
            WHERE trait_members.token_id = tokens.token_id
          UNION ALL
          SELECT cnf_id AS scope FROM cnf_members
            WHERE cnf_members.token_id = tokens.token_id
        )
        ORDER BY rank
        LIMIT 1
      ) AS "bidId"
    FROM tokens JOIN this_project_id USING (project_id)
    ORDER BY token_id
    ;
  `);
  const result = res[res.length - 1].rows;
  await client.query("ROLLBACK");
  return result;
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
  askDetails,
  floorAsk,
  floorAskIdsForAllTokensInProject,
  floorAskForEveryProject,
  bidIdsForToken,
  bidDetails,
  bidDetailsForToken,
  highBidIdsForAllTokensInProject,
};
