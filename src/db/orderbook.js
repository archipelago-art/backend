const ethers = require("ethers");
const { idType, ObjectType, objectTypeToName, newId } = require("./id");
const { hexToBuf, bufToAddress, bufToHex } = require("./util");
const ws = require("./ws");

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
      active_currency_balance,
      active_market_approved,
      active_nonce,
      active_deadline,
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
      true,
      true,
      true,
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

  const wsMessage = {
    type: "BID_PLACED",
    topic: slug,
    data: {
      bidId,
      projectId,
      slug,
      scope: outputScope,
      venue: "ARCHIPELAGO",
      bidder,
      nonce: String(nonce),
      currency: "ETH",
      price: String(price),
      timestamp: createTime.toISOString(),
      expirationTime: deadline && deadline.toISOString(),
    },
  };
  await ws.sendMessages({ client, messages: [wsMessage] });

  await client.query("COMMIT");
  return bidId;
}

async function updateActivityForNonces({
  client,
  updates /*: Array<{ account: address, nonce: uint256, active: boolean }> */,
}) {
  const accounts = Array(updates.length);
  const nonces = Array(updates.length);
  const actives = Array(updates.length);
  for (let i = 0; i < updates.length; i++) {
    accounts[i] = hexToBuf(updates[i].account);
    nonces[i] = updates[i].nonce;
    actives[i] = updates[i].active;
  }
  const bidUpdatesRes = await client.query(
    `
    UPDATE bids
    SET
      active_nonce = updates.active_nonce,
      active = (
        active_currency_balance
        AND active_market_approved
        AND updates.active_nonce
        AND active_deadline
      )
    FROM
      unnest($1::address[], $2::uint256[], $3::boolean[])
        AS updates(account, nonce, active_nonce)
    WHERE
      bids.bidder = updates.account
      AND bids.nonce = updates.nonce
      AND active_deadline
    RETURNING
      bid_id AS "bidId",
      project_id AS "projectId",
      (SELECT slug FROM projects p WHERE p.project_id = bids.project_id) AS "slug",
      active
    `,
    [accounts, nonces, actives]
  );
  const askUpdatesRes = await client.query(
    `
    UPDATE asks
    SET
      active_nonce = updates.active_nonce,
      active = (
        (active_token_owner OR active_token_operator OR active_token_operator_for_all)
        AND (active_market_approved OR active_market_approved_for_all)
        AND updates.active_nonce
        AND active_deadline
      )
    FROM
      unnest($1::address[], $2::uint256[], $3::boolean[])
        AS updates(account, nonce, active_nonce)
    WHERE
      asks.asker = updates.account
      AND asks.nonce = updates.nonce
      AND active_deadline
    RETURNING
      ask_id AS "askId",
      project_id AS "projectId",
      (SELECT slug FROM projects p WHERE p.project_id = asks.project_id) AS "slug",
      active
    `,
    [accounts, nonces, actives]
  );
  // TODO(@wchargin): Also re-send order-placed messages on reactivation.
  const wsMessages = [
    ...bidUpdatesRes.rows
      .filter((r) => !r.active)
      .map((r) => ({
        type: "BID_CANCELLED",
        topic: r.slug,
        data: {
          bidId: r.bidId,
          projectId: r.projectId,
          slug: r.slug,
        },
      })),
    ...askUpdatesRes.rows
      .filter((r) => !r.active)
      .map((r) => ({
        type: "ASK_CANCELLED",
        topic: r.slug,
        data: {
          askId: r.askId,
          projectId: r.projectId,
          slug: r.slug,
        },
      })),
  ];
  await ws.sendMessages({ client, messages: wsMessages });
}

async function updateActivityForNonce({ client, account, nonce, active }) {
  await updateActivityForNonces({
    client,
    updates: [{ account, nonce, active }],
  });
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
  const tokenDetailsRes = await client.query(
    `
    SELECT
      t.token_index as "tokenIndex",
      p.slug
    FROM tokens t
    JOIN projects p USING (project_id)
    WHERE t.token_id = $1
    `,
    [tokenId]
  );
  const { tokenIndex, slug } = tokenDetailsRes.rows[0];
  const askId = newId(ObjectType.ASK);
  const insertRes = await client.query(
    `
    INSERT INTO asks (
      ask_id,
      project_id,
      token_id,
      active,
      active_token_owner, active_token_operator, active_token_operator_for_all,
      active_market_approved, active_market_approved_for_all,
      active_nonce,
      active_deadline,
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
      true, false, false,
      false, true,
      true,
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

  const { createTime } = insertRes.rows[0];

  const wsMessage = {
    type: "ASK_PLACED",
    topic: slug,
    data: {
      askId,
      projectId,
      slug,
      tokenIndex,
      venue: "ARCHIPELAGO",
      asker,
      nonce: String(nonce),
      currency: "ETH",
      price: String(price),
      timestamp: createTime.toISOString(),
      expirationTime: deadline && deadline.toISOString(),
    },
  };
  await ws.sendMessages({ client, messages: [wsMessage] });

  await client.query("COMMIT");
  return askId;
}

async function askIdsForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT ask_id AS "askId"
    FROM asks
    WHERE active
    AND token_id = $1
    ORDER BY price DESC, create_time ASC
    `,
    [tokenId]
  );
  return res.rows.map((r) => r.askId);
}

async function askDetails({ client, askIds }) {
  const res = await client.query(
    `
    SELECT
      ask_id AS "askId",
      price,
      create_time AS "createTime",
      deadline,
      asker,
      nonce,
      token_id AS "tokenId",
      signature,
      message,
      agreement
    FROM asks
    WHERE ask_id = ANY($1::askid[])
    `,
    [askIds]
  );
  return res.rows.map((r) => ({
    askId: r.askId,
    price: ethers.BigNumber.from(r.price),
    createTime: r.createTime,
    deadline: r.deadline,
    asker: bufToAddress(r.asker),
    nonce: String(r.nonce),
    tokenId: r.tokenId,
    message: bufToHex(r.message),
    signature: bufToHex(r.signature),
    agreement: bufToHex(r.agreement),
  }));
}

async function askDetailsForToken({ client, tokenId }) {
  const askIds = await askIdsForToken({ client, tokenId });
  return await askDetails({ client, askIds });
}

async function floorAsks({ client, projectId, tokenId, limit }) {
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
    LIMIT $3
    `,
    [tokenId, projectId, limit]
  );
  return res.rows.map((r) => r.askId);
}

async function floorAsk({ client, projectId, tokenId }) {
  const res = await floorAsks({ client, projectId, tokenId, limit: 1 });
  if (res.length === 0) return null;
  return res[0];
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

async function bidIdsForAddress({ client, address, activeOnly = true }) {
  const deadline = activeOnly ? new Date() : null;
  const res = await client.query(
    `
      SELECT bid_id as "bidId"
      FROM bids
      WHERE bidder = $1
      AND (deadline > $2 OR $2 IS NULL)
      ORDER BY create_time ASC
    `,
    [hexToBuf(address), deadline]
  );
  return res.rows.map((row) => row.bidId);
}

async function askIdsForAddress({ client, address, activeOnly = true }) {
  const deadline = activeOnly ? new Date() : null;
  const res = await client.query(
    `
      SELECT ask_id as "askId"
      FROM asks
      WHERE asker = $1
      AND (deadline > $2 OR $2 IS NULL)
      ORDER BY create_time ASC
    `,
    [hexToBuf(address), deadline]
  );
  return res.rows.map((row) => row.askId);
}

async function bidDetails({ client, bidIds }) {
  const res = await client.query(
    `
    SELECT
      bid_id AS "bidId",
      slug,
      price,
      deadline,
      bidder,
      scope,
      nonce,
      signature,
      message,
      agreement
    FROM bids
    JOIN projects using (project_id)
    WHERE bid_id = ANY($1::bidid[])
    `,
    [bidIds]
  );
  return res.rows.map((r) => ({
    bidId: r.bidId,
    slug: r.slug,
    price: ethers.BigNumber.from(r.price),
    deadline: r.deadline,
    bidder: bufToAddress(r.bidder),
    nonce: String(r.nonce),
    signature: bufToHex(r.signature),
    message: bufToHex(r.message),
    agreement: bufToHex(r.agreement),
    scope: {
      type: objectTypeToName[idType(r.scope)],
      scope: r.scope,
    },
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
  updateActivityForNonce,
  updateActivityForNonces,
  askDetails,
  askDetailsForToken,
  askIdsForToken,
  floorAsk,
  floorAsks,
  floorAskIdsForAllTokensInProject,
  floorAskForEveryProject,
  askIdsForAddress,
  bidIdsForToken,
  bidIdsForAddress,
  bidDetails,
  bidDetailsForToken,
  highBidIdsForAllTokensInProject,
};
