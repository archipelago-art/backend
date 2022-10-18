const ethers = require("ethers");

const sdk = require("@archipelago-art/contracts");

const log = require("../util/log")(__filename);
const { idType, ObjectType, objectTypeToName, newId } = require("./id");
const { hexToBuf, bufToAddress, bufToHex } = require("./util");
const ws = require("./ws");

const DEFAULT_MARKET = "0x555598409fe9a72f0a5e423245c34555f6445555";

/**
 * type Scope = ProjectScope | TokenScope | TraitScope | CnfScope;
 * type ProjectScope = {type: "PROJECT", projectId}
 * type TokenScope = {type: "TOKEN", tokenId}
 * type TraitScope = {type: "TRAIT", traitId}
 * type CnfScope = {type: "CNF", cnfId}
 */
async function addBid({
  client,
  noVerify = false,
  chainId = 1,
  marketAddress = DEFAULT_MARKET,
  scope /*: Scope */,
  price /*: ethers.BigNumber */,
  deadline /*: Date */,
  bidder /*: address */,
  nonce /*: uint256 */,
  agreement /*: bytes: ABI-encoded [OrderAgreement] */,
  message /*: bytes: ABI-encoded [Bid] */,
  signature /*: bytes65 */,
}) {
  // Verify signatures and hash integrity.
  if (!noVerify) {
    const [agreementStruct] = ethers.utils.defaultAbiCoder.decode(
      [sdk.market.abi.OrderAgreement],
      agreement
    );
    const [bidStruct] = ethers.utils.defaultAbiCoder.decode(
      [sdk.market.abi.Bid],
      message
    );
    const agreementStructHash = sdk.market.hash.orderAgreement(agreementStruct);
    if (bidStruct.agreementHash !== agreementStructHash) {
      throw new Error(
        `bid agreement hash: want ${agreementStructHash}, got ${bidStruct.agreementHash}`
      );
    }
    const recoveredSigner = sdk.market.verify712.bid(
      signature,
      { chainId, marketAddress },
      bidStruct
    );
    if (recoveredSigner !== bidder) {
      throw new Error(`bid signer: want ${bidder}, got ${recoveredSigner}`);
    }
  }

  await client.query("BEGIN");
  let projectId, scopeId;

  switch (scope.type) {
    case "PROJECT": {
      await checkProjectExists(client, scope.projectId);
      projectId = scope.projectId;
      scopeId = projectId;
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
      break;
    }
    case "TRAIT": {
      projectId = await projectForTraitId(client, scope.traitId);
      scopeId = scope.traitId;
      break;
    }
    case "CNF": {
      projectId = await projectForCnfId(client, scope.cnfId);
      scopeId = scope.cnfId;
      break;
    }
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
  const insertRes = await client.query(
    `
    WITH inputs AS (
      SELECT
        $1::bidid AS bid_id,
        $2::projectid AS project_id,
        $3::bidscope AS scope,
        $4::uint256 AS price,
        $5::timestamptz AS deadline,
        $6::address AS bidder,
        $7::uint256 AS nonce,
        $8::bytea AS agreement,
        $9::bytea AS message,
        $10::signature AS signature
    ),
    activity AS (
      SELECT
        NOT EXISTS (
          SELECT 1 FROM nonce_cancellations
          WHERE account = $6::address AND nonce = $7::uint256
        ) AS active_nonce,
        now() <= $5::timestamptz AS active_deadline
    )
    INSERT INTO bids (
      bid_id, project_id, scope,
      active,
      active_currency_balance,
      active_market_approved,
      active_nonce,
      active_deadline,
      price,
      deadline, create_time,
      bidder, nonce,
      agreement, message, signature
    )
    SELECT
      bid_id, project_id, scope,
      active_nonce AND active_deadline,
      true, true, active_nonce, active_deadline,
      price,
      deadline, now(),
      bidder, nonce,
      agreement, message, signature
    FROM inputs, activity
    RETURNING active
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
      hexToBuf(ethers.utils.joinSignature(signature)),
    ]
  );

  if (insertRes.rows[0].active)
    await sendBidActivityMessages({ client, bidIds: [bidId] });

  await client.query("COMMIT");
  log.debug`addBid: added bid ${bidId}`;
  return bidId;
}

async function sendBidActivityMessages({ client, bidIds }) {
  const res = await client.query(
    `
    SELECT
      bid_id AS "bidId",
      active,
      project_id AS "projectId",
      slug,
      scope,
      token_info.token_index AS "tokenIndex",
      trait_info.feature_id AS "featureId",
      trait_info.feature_name AS "featureName",
      trait_info.trait_value AS "traitValue",
      bidder,
      nonce,
      price,
      create_time AS "createTime",
      deadline
    FROM
      bids
      JOIN projects USING (project_id)
      LEFT OUTER JOIN (
        SELECT trait_id, feature_id, name AS feature_name, value AS trait_value
        FROM traits JOIN features USING (feature_id)
      ) AS trait_info ON bids.scope = trait_info.trait_id
      LEFT OUTER JOIN (
        SELECT token_id, token_index FROM tokens
      ) AS token_info ON bids.scope = token_info.token_id
    WHERE
      bid_id = ANY($1::bidid[])
    `,
    [bidIds]
  );

  const messages = [];
  for (const row of res.rows) {
    if (row.active) {
      let outputScope = {};
      switch (idType(row.scope)) {
        case ObjectType.TOKEN:
          outputScope = {
            type: "TOKEN",
            tokenId: row.scope,
            tokenIndex: row.tokenIndex,
          };
          break;
        case ObjectType.PROJECT:
          outputScope = {
            type: "PROJECT",
            projectId: row.scope,
            slug: row.slug,
          };
          break;
        case ObjectType.TRAIT:
          outputScope = {
            type: "TRAIT",
            traitId: row.scope,
            featureName: row.featureName,
            traitValue: row.traitValue,
          };
          break;
        case ObjectType.CNF:
          outputScope = {
            type: "CNF",
            cnfId: row.scope,
          };
          break;
        default:
          throw new Error(
            `unexpected type for bid scope: ${row.scope} => ${idType(
              row.scope
            )}`
          );
      }
      messages.push({
        type: "BID_PLACED",
        topic: row.slug,
        data: {
          bidId: row.bidId,
          projectId: row.projectId,
          slug: row.slug,
          scope: outputScope,
          venue: "ARCHIPELAGO",
          bidder: bufToAddress(row.bidder),
          nonce: row.nonce,
          currency: "ETH",
          price: row.price,
          timestamp: row.createTime.toISOString(),
          deadline: row.deadline && row.deadline.toISOString(),
        },
      });
    } else {
      messages.push({
        type: "BID_CANCELLED",
        topic: row.slug,
        data: {
          bidId: row.bidId,
          projectId: row.projectId,
          slug: row.slug,
          venue: "ARCHIPELAGO",
        },
      });
    }
  }

  await ws.sendMessages({ client, messages });
}

async function sendAskActivityMessages({ client, askIds }) {
  const res = await client.query(
    `
    SELECT
      asks.ask_id AS "askId",
      asks.active,
      projects.project_id AS "projectId",
      projects.slug,
      tokens.token_index AS "tokenIndex"
    FROM
      asks
      JOIN projects USING (project_id)
      JOIN tokens USING (token_id)
    WHERE
      ask_id = ANY($1::askid[])
    `,
    [askIds]
  );

  const messages = [];
  for (const row of res.rows) {
    if (row.active) {
      // TODO(@wchargin): Also re-send order-placed messages on reactivation.
      continue;
    } else {
      messages.push({
        type: "ASK_CANCELLED",
        topic: row.slug,
        data: {
          askId: row.askId,
          projectId: row.projectId,
          slug: row.slug,
          tokenIndex: row.tokenIndex,
          venue: "ARCHIPELAGO",
        },
      });
    }
  }

  await ws.sendMessages({ client, messages });
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
    nonces[i] = String(ethers.BigNumber.from(updates[i].nonce));
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
    RETURNING bid_id AS "bidId"
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
    RETURNING ask_id AS "askId"
    `,
    [accounts, nonces, actives]
  );

  const bidIds = bidUpdatesRes.rows.map((r) => r.bidId);
  const askIds = askUpdatesRes.rows.map((r) => r.askId);
  await sendBidActivityMessages({ client, bidIds });
  await sendAskActivityMessages({ client, askIds });
  log.debug`updateActivityForNonces: updated ${bidIds.length} bids, ${askIds.length} asks`;
}

async function updateActivityForNonce({ client, account, nonce, active }) {
  await updateActivityForNonces({
    client,
    updates: [{ account, nonce, active }],
  });
}

/**
 * If `updates` has multiple entries for a given token ID, the last one is taken.
 */
async function updateActivityForTokenOwners({
  client,
  updates /*: Array<{ tokenId, newOwner: address }> */,
}) {
  const tokenIdToOwner = new Map(
    updates.map(({ tokenId, newOwner }) => [tokenId, hexToBuf(newOwner)])
  );
  const askUpdatesRes = await client.query(
    `
    UPDATE asks
    SET
      active_token_owner = (asks.asker = updates.new_owner),
      active = (
        ((asks.asker = updates.new_owner) OR active_token_operator OR active_token_operator_for_all)
        AND (active_market_approved OR active_market_approved_for_all)
        AND active_nonce
        AND active_deadline
      )
    FROM
      unnest($1::tokenid[], $2::address[])
        AS updates(token_id, new_owner)
    WHERE asks.token_id = updates.token_id
    RETURNING ask_id AS "askId"
    `,
    [Array.from(tokenIdToOwner.keys()), Array.from(tokenIdToOwner.values())]
  );
  const askIds = askUpdatesRes.rows.map((r) => r.askId);
  await sendAskActivityMessages({ client, askIds });
  log.debug`updateActivityForTokenOwners: updated ${askIds.length} asks`;
}

async function updateActivityForCurrencyBalances({
  client,
  updates /*: Array<{ account: address, newBalance: uint256 }> */,
}) {
  const bidUpdatesRes = await client.query(
    `
    UPDATE bids
    SET
      active_currency_balance = (price <= updates.new_balance),
      active = (
        (price <= updates.new_balance)
        AND active_market_approved
        AND active_nonce
        AND active_deadline
      )
    FROM
      unnest($1::address[], $2::uint256[])
        AS updates(account, new_balance)
    WHERE
      bids.bidder = updates.account
      AND active_deadline
    RETURNING bid_id AS "bidId"
    `,
    [
      updates.map((u) => hexToBuf(u.account)),
      updates.map((u) => String(u.newBalance)),
    ]
  );
  const bidIds = bidUpdatesRes.rows.map((r) => r.bidId);
  await sendBidActivityMessages({ client, bidIds });
  log.debug`updateActivityForCurrencyBalances: updated ${bidIds.length} bids`;
}

async function deactivateExpiredOrders({ client }) {
  const bidUpdatesRes = await client.query(
    `
    UPDATE bids SET active_deadline = false, active = false
    WHERE active AND deadline < now()
    RETURNING bid_id AS "bidId"
    `
  );
  const askUpdatesRes = await client.query(
    `
    UPDATE asks SET active_deadline = false, active = false
    WHERE active AND deadline < now()
    RETURNING
      ask_id AS "askId",
      project_id AS "projectId",
      (SELECT slug FROM projects p WHERE p.project_id = asks.project_id) AS "slug",
      (SELECT token_index FROM tokens t WHERE t.token_id = asks.token_id) AS "tokenIndex"
    `
  );
  const bidIds = bidUpdatesRes.rows.map((r) => r.bidId);
  const askIds = askUpdatesRes.rows.map((r) => r.askId);
  await sendBidActivityMessages({ client, bidIds });
  await sendAskActivityMessages({ client, askIds });
  log.debug`deactivateExpiredOrders: deactivated ${bidIds.length} bids, ${askIds.length} asks`;
  return { bids: bidIds.length, asks: askIds.length };
}

async function addAsk({
  client,
  noVerify = false,
  chainId = 1,
  marketAddress = DEFAULT_MARKET,
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
      p.slug,
      t.token_index as "tokenIndex",
      t.token_contract AS "tokenContract",
      t.on_chain_token_id AS "onChainTokenId"
    FROM tokens t
    JOIN projects p USING (project_id)
    WHERE t.token_id = $1
    `,
    [tokenId]
  );
  const { slug, tokenIndex, onChainTokenId } = tokenDetailsRes.rows[0];
  const tokenContract = bufToAddress(tokenDetailsRes.rows[0].tokenContract);

  // Verify signatures and hash integrity.
  if (!noVerify) {
    const [agreementStruct] = ethers.utils.defaultAbiCoder.decode(
      [sdk.market.abi.OrderAgreement],
      agreement
    );
    const [askStruct] = ethers.utils.defaultAbiCoder.decode(
      [sdk.market.abi.Ask],
      message
    );
    const agreementStructHash = sdk.market.hash.orderAgreement(agreementStruct);
    if (askStruct.agreementHash !== agreementStructHash) {
      throw new Error(
        `ask agreement hash: want ${agreementStructHash}, got ${askStruct.agreementHash}`
      );
    }
    if (agreementStruct.tokenAddress !== tokenContract) {
      throw new Error(
        `ask tokenContract: want ${tokenContract}, got ${agreementStruct.tokenAddress}`
      );
    }
    if (String(askStruct.tokenId) !== onChainTokenId) {
      throw new Error(
        `ask tokenId: want ${onChainTokenId}, got ${askStruct.tokenId}`
      );
    }
    const recoveredSigner = sdk.market.verify712.ask(
      signature,
      { chainId, marketAddress },
      askStruct
    );
    if (recoveredSigner !== asker) {
      throw new Error(`ask signer: want ${asker}, got ${recoveredSigner}`);
    }
  }

  const askId = newId(ObjectType.ASK);
  const insertRes = await client.query(
    `
    WITH inputs AS (
      SELECT
        $1::askid AS ask_id,
        $2::projectid AS project_id,
        $3::tokenid AS token_id,
        $4::uint256 AS price,
        $5::timestamptz AS deadline,
        $6::address AS asker,
        $7::uint256 AS nonce,
        $8::bytea AS agreement,
        $9::bytea AS message,
        $10::signature AS signature
    ),
    activity AS (
      SELECT
        NOT EXISTS (
          SELECT 1 FROM nonce_cancellations
          WHERE account = $6::address AND nonce = $7::uint256
        ) AS active_nonce,
        now() <= $5::timestamptz AS active_deadline
    )
    INSERT INTO asks (
      ask_id, project_id, token_id,
      active,
      active_token_owner, active_token_operator, active_token_operator_for_all,
      active_market_approved, active_market_approved_for_all,
      active_nonce,
      active_deadline,
      price,
      deadline, create_time,
      asker, nonce,
      agreement, message, signature
    )
    SELECT
      ask_id, project_id, token_id,
      active_nonce AND active_deadline,
      true, false, false,
      false, true,
      active_nonce,
      active_deadline,
      price,
      deadline, now(),
      asker, nonce,
      agreement, message, signature
    FROM inputs, activity
    RETURNING active, create_time AS "createTime"
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
      hexToBuf(ethers.utils.joinSignature(signature)),
    ]
  );

  const { active, createTime } = insertRes.rows[0];

  if (active) {
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
        deadline: deadline && deadline.toISOString(),
      },
    };
    await ws.sendMessages({ client, messages: [wsMessage] });
  }

  await client.query("COMMIT");
  log.debug`addBid: added ask ${askId}`;
  return askId;
}

async function askIdsForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT ask_id AS "askId"
    FROM asks
    WHERE active AND deadline > now()
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
      slug,
      name,
      price,
      create_time AS "createTime",
      deadline,
      asker,
      nonce,
      token_id AS "tokenId",
      token_index AS "tokenIndex",
      signature,
      message,
      agreement
    FROM asks
    JOIN projects using (project_id)
    JOIN tokens using (token_id)
    WHERE ask_id = ANY($1::askid[])
    `,
    [askIds]
  );
  return res.rows.map((r) => ({
    askId: r.askId,
    slug: r.slug,
    name: r.name,
    price: ethers.BigNumber.from(r.price),
    createTime: r.createTime,
    deadline: r.deadline,
    asker: bufToAddress(r.asker),
    nonce: String(r.nonce),
    tokenId: r.tokenId,
    tokenIndex: r.tokenIndex,
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
      AND active AND deadline > now()
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
        AND active AND deadline > now()
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
    SELECT ask_id AS "askId", asker, project_id AS "projectId", price
    FROM (
      SELECT
        ask_id,
        asker,
        project_id,
        rank() OVER (
          PARTITION BY project_id
          ORDER BY price ASC, create_time ASC
        ) AS ask_rank,
        price
      FROM asks
      WHERE active AND deadline > now()
    ) AS ranked_asks
    WHERE ask_rank = 1
    ORDER BY project_id
    `
  );
  return res.rows.map((r) => ({
    ...r,
    price: ethers.BigNumber.from(r.price),
    asker: bufToAddress(r.asker),
  }));
}

/**
 * Return all active bids that match a token
 */
async function bidIdsForToken({ client, tokenId }) {
  const res = await client.query(
    `
    SELECT bid_id AS "bidId"
    FROM bids
    WHERE active AND deadline > now()
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
      WHERE active AND deadline > now()
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

// Returns a list of `{ tokenId, bidId }`. Tokens without a bid will not appear
// in the result. Bids by the token owner don't count.
async function highBidIdsForTokensOwnedBy({ client, account /*: address */ }) {
  // Compared to `highBidIdsForAllTokensInProject`, we take a different plan:
  // since tokens may be from many different projects, scopes will overlap
  // less, so we directly compute the highest bid for each token rather than
  // buffering through scopes.
  const res = await client.query(
    `
    WITH owned_tokens(token_id) AS (
      SELECT token_id FROM (
        SELECT DISTINCT ON (token_id) token_id, to_address
        FROM erc721_transfers
        WHERE to_address = $1::address OR from_address = $1::address
        ORDER BY token_id, block_number DESC, log_index DESC
      ) q
      WHERE to_address = $1::address
    )
    SELECT DISTINCT ON (token_id)
      token_id AS "tokenId",
      bid_id AS "bidId"
    FROM
      owned_tokens AS ot,
      LATERAL (
        SELECT token_id
        UNION ALL
        SELECT project_id FROM tokens t WHERE t.token_id = ot.token_id
        UNION ALL
        SELECT trait_id FROM trait_members WHERE trait_members.token_id = ot.token_id
        UNION ALL
        SELECT cnf_id FROM cnf_members WHERE cnf_members.token_id = ot.token_id
      ) AS scopes(scope)
      JOIN bids USING (scope)
    WHERE bids.active AND (bids.deadline > now()) AND bids.bidder <> $1::address
    ORDER BY token_id, bids.price DESC, bids.create_time ASC
    `,
    [hexToBuf(account)]
  );
  return res.rows;
}

async function highFloorBidsForAllProjects({ client }) {
  const res = await client.query(
    `
    SELECT DISTINCT ON (b.scope)
      b.price,
      b.scope as "projectId",
      b.bid_id as "bidId",
      CONCAT('0x', encode(b.bidder, 'hex')) as "bidder",
      p.slug
    FROM bids b
    JOIN projects p USING (project_id)
    WHERE
      b.active AND b.deadline > now()
      AND b.scope >> 58 = 2
    ORDER BY
    b.scope,
    b.price DESC
    ;
  `
  );
  let result = {};
  for (const row of res.rows) {
    const { slug, ...rest } = row;
    result[slug] = rest;
  }
  return result;
}

async function bidIdsForAddress({
  client,
  address,
  includeTemporarilyInactive = false,
}) {
  const res = await client.query(
    `
    SELECT bid_id as "bidId" FROM bids
    WHERE
      bidder = $1
      AND deadline > now()
      AND (
        CASE
          WHEN $2::boolean THEN active_nonce
          ELSE active
        END
      )
    ORDER BY create_time ASC
    `,
    [hexToBuf(address), includeTemporarilyInactive]
  );
  return res.rows.map((row) => row.bidId);
}

async function askIdsForAddress({
  client,
  address,
  includeTemporarilyInactive = false,
}) {
  const res = await client.query(
    `
    SELECT ask_id as "askId" FROM asks
    WHERE
      asker = $1
      AND deadline > now()
      AND (
        CASE
          WHEN $2::boolean THEN active_nonce
          ELSE active
        END
      )
    ORDER BY create_time ASC
    `,
    [hexToBuf(address), includeTemporarilyInactive]
  );
  return res.rows.map((row) => row.askId);
}

async function bidDetails({ client, bidIds }) {
  const res = await client.query(
    `
    SELECT
      bid_id AS "bidId",
      slug,
      name,
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
    name: r.name,
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

async function bidsSharingScope({
  client,
  scope,
  address,
  activeOnly = true,
} = {}) {
  const res = await client.query(
    `
    SELECT
      bid_id as "bidId",
      price,
      bidder,
      deadline,
      create_time as "createTime"
    FROM bids
      WHERE ((active AND deadline > now()) OR NOT $1::boolean)
      AND scope = $2
      AND (bidder = $3 OR $3 IS NULL)
    ORDER BY price DESC;
    `,
    [activeOnly, scope, address ? hexToBuf(address) : null]
  );
  return res.rows.map((r) => ({
    bidId: r.bidId,
    price: String(r.price),
    bidder: bufToAddress(r.bidder),
    deadline: r.deadline.toISOString(),
    createTime: r.createTime.toISOString(),
  }));
}

async function fillsForAddress({ client, address }) {
  const res = await client.query(
    `
    SELECT
      p.project_id AS "projectId",
      p.name,
      p.slug,
      p.image_template AS "imageTemplate",
      t.token_index AS "tokenIndex",
      t.token_id AS "tokenId",
      f.buyer,
      f.seller,
      f.price,
      f.block_number AS "blockNumber",
      f.trade_id AS "tradeId",
      t.on_chain_token_id AS "onChainTokenId",
      t.token_contract AS "tokenContract"
    FROM fills f
      JOIN projects p USING (project_id)
      JOIN tokens t USING (token_id)
    WHERE f.buyer = $1 OR f.seller = $1
    `,
    [hexToBuf(address)]
  );
  return res.rows.map((r) => ({
    tradeId: bufToHex(r.tradeId),
    projectId: r.projectId,
    name: r.name,
    slug: r.slug,
    imageTemplate: r.imageTemplate,
    tokenIndex: r.tokenIndex,
    tokenId: r.tokenId,
    buyer: bufToAddress(r.buyer),
    seller: bufToAddress(r.seller),
    price: String(r.price),
    blockNumber: r.blockNumber,
    onChainTokenId: r.onChainTokenId,
    tokenContract: bufToAddress(r.tokenContract),
  }));
}

module.exports = {
  DEFAULT_MARKET,
  addBid,
  addAsk,
  updateActivityForNonce,
  updateActivityForNonces,
  updateActivityForTokenOwners,
  updateActivityForCurrencyBalances,
  deactivateExpiredOrders,
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
  highBidIdsForTokensOwnedBy,
  highFloorBidsForAllProjects,
  bidsSharingScope,
  fillsForAddress,
};
