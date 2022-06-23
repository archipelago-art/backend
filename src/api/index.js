const accounts = require("../db/accounts");
const artblocks = require("../db/artblocks");
const cnfs = require("../db/cnfs");
const emails = require("../db/emails");
const eth = require("../db/eth");
const orderbook = require("../db/orderbook");
const { bufToAddress, hexToBuf } = require("../db/util");
const ws = require("../db/ws");
const normalizeAspectRatio = require("../scrape/normalizeAspectRatio");
const slugify = require("../util/slugify");
const { sortAsciinumeric } = require("../util/sortAsciinumeric");
const openseaApi = require("../db/opensea/api");
const dbTokens = require("../db/tokens");

const PROJECT_STRIDE = 1e6;

function artblocksProjectIdToCollectionName(id) {
  if (!Number.isInteger(id)) throw new Error("non-numeric project ID: " + id);
  return `ab-${id}`;
}
const RE_ARTBLOCKS_COLLECTION = /^ab-(0|[1-9][0-9]*)$/;

const PARAM_BASE_URL = "{baseUrl}";
const PARAM_SIZE = "{sz}";
const PARAM_INDEX_LOW = "{lo}";
const PARAM_INDEX_HIGH = "{hi}";

const IMAGE_BASE_URL = "https://img.archipelago.art";

function collectionNameToArtblocksProjectId(name) {
  const match = name.match(RE_ARTBLOCKS_COLLECTION);
  if (!match) return null;
  return Number(match[1]);
}

function collectionNameToArtblocksProjectIdUnwrap(name) {
  const projectId = collectionNameToArtblocksProjectId(name);
  if (projectId == null) throw new Error("bad collection ID: " + collection);
  return projectId;
}

async function tokenIdBySlugAndIndex({ client, slug, tokenIndex }) {
  const res = await client.query(
    `
    SELECT token_id AS id
    FROM projects JOIN tokens USING (project_id)
    WHERE projects.slug = $1 AND tokens.token_index = $2
    `,
    [slug, tokenIndex]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].id;
}

async function resolveProjectId({ client, slug }) {
  const res = await client.query(
    `
    SELECT project_id AS id FROM projects
    WHERE slug = $1
    `,
    [slug]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0].id;
}

async function resolveTraitIds({
  client,
  projectId,
  keys /*: Array<{featureName: string, traitValue: string}> */,
}) {
  const res = await client.query(
    `
    SELECT
      feature_id AS "featureId",
      trait_id AS "traitId",
      features.name AS "featureName",
      traits.value AS "traitValue"
    FROM
      features
      JOIN traits USING (feature_id)
      JOIN unnest($2::text[], $3::text[]) AS keys(name, value) USING (name, value)
    WHERE project_id = $1::projectid
    ORDER BY feature_id, trait_id
    `,
    [projectId, keys.map((k) => k.featureName), keys.map((k) => k.traitValue)]
  );
  return res.rows;
}

async function getCnfTraits({ client, cnfIds }) {
  return await cnfs.retrieveCnfs({ client, cnfIds });
}

async function getTraitData({ client, traitIds }) {
  const res = await client.query(
    `
    SELECT
      feature_id AS "featureId",
      trait_id AS "traitId",
      features.name AS "featureName",
      traits.value AS "traitValue",
      projects.project_id AS "projectId"
    FROM traits
      JOIN features USING (feature_id)
      JOIN projects USING (project_id)
    WHERE trait_id = ANY($1::traitid[])
    ORDER BY trait_id
    `,
    [traitIds]
  );
  return res.rows;
}

/**
 * Get trait membership data for a set of traits for a specific token id.
 * The membership data will be provided for a block of 256 token indices, which
 * will include the reference token.
 * Returns: Promise<Array<{traitId, indices: Array<int>}>>
 */
async function blockAlignedTraitMembers({ client, traitIds, tokenId }) {
  const res = await client.query(
    `
    WITH token_range(project_id, min_token_index) AS (
      SELECT project_id, (token_index >> 8) << 8
      FROM tokens WHERE token_id = $1::tokenid
    )
    SELECT token_index AS "tokenIndex", trait_id AS "traitId"
    FROM
      trait_members
      JOIN unnest($2::traitid[]) AS these_traits(trait_id) USING (trait_id)
      JOIN tokens USING (token_id)
    WHERE
      project_id = (SELECT project_id FROM token_range)
      AND token_index >= (SELECT min_token_index FROM token_range)
      AND token_index < (SELECT min_token_index + 256 FROM token_range)
    ORDER BY trait_id, token_index
    `,
    [tokenId, traitIds]
  );
  const traitToTokenIndices = new Map(traitIds.map((x) => [x, []]));
  for (const { tokenIndex, traitId } of res.rows) {
    traitToTokenIndices.get(traitId).push(tokenIndex);
  }
  return traitIds.map((x) => ({
    traitId: x,
    tokenIndices: traitToTokenIndices.get(x),
  }));
}

async function _collections({ client, projectId }) {
  const res = await client.query(
    `
    SELECT
      projects.project_id AS "id",
      artblocks_project_index AS "artblocksProjectIndex",
      slug AS "slug",
      name AS "name",
      artist_name AS "artistName",
      description AS "description",
      aspect_ratio AS "aspectRatio",
      num_tokens AS "numTokens",
      max_invocations AS "maxInvocations",
      image_template AS "imageTemplate",
      token_contract AS "tokenContract"
    FROM projects
    LEFT OUTER JOIN artblocks_projects USING (project_id)
    WHERE project_id = $1 OR $1 IS NULL
    ORDER BY
      artblocks_project_index ASC,
      project_id ASC
    `,
    [projectId]
  );
  return res.rows.map((row) => ({
    projectId: row.id,
    slug: row.slug,
    artblocksProjectIndex: row.artblocksProjectIndex,
    imageUrlTemplate: row.imageTemplate.replace(PARAM_BASE_URL, IMAGE_BASE_URL),
    name: row.name,
    artistName: row.artistName,
    description: row.description,
    aspectRatio: row.aspectRatio,
    numTokens: row.numTokens,
    maxInvocations: row.maxInvocations,
    tokenContract: bufToAddress(row.tokenContract),
    fees: (() => {
      if (row.slug === "cryptoadz") return feesForCollection("CRYPTOADZ");
      if (row.slug === "autoglyphs") return feesForCollection("AUTOGLYPHS");
      const addr = bufToAddress(row.tokenContract);
      if (
        addr === artblocks.CONTRACT_ARTBLOCKS_LEGACY ||
        addr === artblocks.CONTRACT_ARTBLOCKS_STANDARD
      ) {
        return feesForCollection("ARTBLOCKS");
      }
      throw new Error("can't get fees; unrecognized collection " + row.slug);
    })(),
  }));
}

async function collections({ client }) {
  return await _collections({ client, projectId: null });
}

async function collection({ client, slug }) {
  const projectId = await resolveProjectId({ client, slug });
  if (projectId == null) return null;
  const res = await _collections({ client, projectId });
  return res[0] ?? null;
}

function feesForCollection(
  type /*: "ARTBLOCKS" | "CRYPTOADZ" | "AUTOGLYPHS" */
) {
  const ARCHIPELAGO_PROTOCOL_PAYEE =
    "0x1fC12C9f68A6B0633Ba5897A40A8e61ed9274dC9";
  const ARCHIPELAGO_FRONTEND_PAYEE =
    "0xA76456bb6aBC50FB38e17c042026bc27a95C3314";
  const ARTBLOCKS_ROYALTY_ORACLE = "0x8A3F65eF24021D401815792c4B65676FBF90663c";
  // CrypToadz payee determined from:
  //   - the CrypToadz contract is 0x1CB1A5e65610AEFF2551A50f76a87a7d3fB649C6;
  //   - its `contractURI()` returns "ipfs://QmV1SZzgaCWGvExViNRaRYg396NgEknp4cmYihcrJSPhKm"
  //     as of mainnet block 14969134;
  //   - that resolves to a JSON document with the top-level key-value pair
  //     `"fee_recipient": "0x87757c7fD54D892176e9ECEc6767Bc16e04a06a8"`.
  const CRYPTOADZ_PAYEE = "0x87757c7fD54D892176e9ECEc6767Bc16e04a06a8";

  const fees = [
    {
      target: ARCHIPELAGO_PROTOCOL_PAYEE,
      micros: 5000,
      static: true,
      includeInOrders: false,
    }, // slight lie
    { target: ARCHIPELAGO_FRONTEND_PAYEE, micros: 5000, static: true },
  ];
  switch (type) {
    case "ARTBLOCKS":
      fees.push({
        target: ARTBLOCKS_ROYALTY_ORACLE,
        micros: 75000,
        static: false,
      });
      break;
    case "CRYPTOADZ":
      fees.push({ target: CRYPTOADZ_PAYEE, micros: 25000, static: true });
      break;
    case "AUTOGLYPHS":
      break;
    default:
      throw new Error("unknown collection type: " + type);
  }
  return fees;
}

async function collectionTokens({ client, slug }) {
  const projectId = await resolveProjectId({ client, slug });
  if (projectId == null) throw new Error("no such collection: " + slug);
  const res = await client.query(
    `
    SELECT
      token_id AS "tokenId",
      token_index AS "tokenIndex"
    FROM tokens
    WHERE project_id = $1
    ORDER BY token_index
    `,
    [projectId]
  );
  return res.rows;
}

async function projectFeaturesAndTraits({ client, slug }) {
  const projectId = await resolveProjectId({ client, slug });
  if (projectId == null) return null;
  const res = await artblocks.getProjectFeaturesAndTraits({
    client,
    projectId,
  });
  for (const feature of res) {
    feature.slug = slugify(feature.name);
    for (const trait of feature.traits) {
      trait.slug = slugify(String(trait.value));
    }
    feature.traits = sortAsciinumeric(feature.traits, (t) => String(t.slug));
  }
  return res;
}

async function tokenFeaturesAndTraits({ client, tokenId }) {
  if (typeof tokenId !== "string") throw new Error("bad token ID: " + tokenId);
  const res = await artblocks.getTokenFeaturesAndTraits({
    client,
    tokenId,
  });
  if (res.length !== 1) return [];
  return formatTokenTraits(res[0].traits);
}

function formatTokenTraits(result) {
  for (const row of result) {
    row.featureSlug = slugify(row.name);
    row.traitSlug = slugify(String(row.value));
  }
  return result;
}

async function tokenChainData({ client, tokenId }) {
  return await artblocks.getTokenChainData({ client, tokenId });
}

// `tokens` should be a list of `{ address, tokenId }` pairs, where `address`
// is a "0x..." string and `tokenId` is a numeric string.
// type TokenSummary = {
//   name: string, // e.g. "Chromie Squiggle"
//   slug: string, // e.g. "chromie-squiggle"
//   imageUrlTemplate: string, // e.g. "https://img.archipelago.art/artbocks/{sz}/0/001/337"
//   tokenIndex: number, // e.g. 7583
//   artistName: string, // e.g. "Snowfro"
//   aspectRatio: number, // e.g. 1.5
// }
async function tokenSummariesByOnChainId({ client, tokens }) {
  if (
    !Array.isArray(tokens) ||
    !tokens.every(
      (t) => typeof t.address === "string" && typeof t.tokenId === "string"
    )
  ) {
    throw new Error(
      "tokenSummariesByOnChainId: must pass array of token addresses and IDs"
    );
  }
  const res = await dbTokens.tokenSummariesByOnChainId({ client, tokens });
  return res.map((x) => ({
    name: x.name,
    slug: x.slug,
    imageUrlTemplate: formatImageUrl({
      template: x.imageTemplate,
      tokenIndex: x.tokenIndex,
    }),
    tokenIndex: x.tokenIndex,
    artistName: x.artistName,
    aspectRatio: x.aspectRatio,
  }));
}

async function tokenSummariesByAccount({ client, account }) {
  const res = await client.query(
    `
    WITH owned_tokens AS (
      SELECT token_id FROM (
        SELECT DISTINCT ON (token_id) token_id, to_address
        FROM erc721_transfers
        WHERE (to_address = $1::address OR from_address = $1::address)
        ORDER BY token_id, block_number DESC, log_index DESC
      ) q
      WHERE to_address = $1::address
    )
    SELECT
      projects.name,
      projects.slug,
      projects.image_template as "imageTemplate",
      tokens.token_index AS "tokenIndex",
      projects.artist_name as "artistName",
      projects.aspect_ratio as "aspectRatio",
      tokens.token_id AS "tokenId",
      tokens.token_contract AS "contractAddress"
    FROM
      owned_tokens
      JOIN tokens USING (token_id)
      JOIN projects USING (project_id)
    ORDER BY token_id
    `,
    [hexToBuf(account)]
  );

  function index(fk, fv = (x) => x) {
    return (xs) => new Map(xs.map((x) => [fk(x), fv(x)]));
  }
  // prettier-ignore
  const highBidIds = await orderbook
    .highBidIdsForTokensOwnedBy({ client, account })
    .then(index((x) => x.tokenId, (x) => x.bidId));
  const highBidDetailsById = await orderbook
    .bidDetails({ client, bidIds: Array.from(new Set(highBidIds.values())) })
    .then(index((x) => x.bidId));
  function highBidForToken(tokenId) {
    const bidId = highBidIds.get(tokenId);
    if (bidId == null) return null;
    const details = highBidDetailsById.get(bidId);
    const { price, deadline, bidder, scope } = details;
    return { bidId, price: String(price), deadline, bidder, scope };
  }

  return res.rows.map((x) => ({
    name: x.name,
    slug: x.slug,
    imageUrlTemplate: formatImageUrl({
      template: x.imageTemplate,
      tokenIndex: x.tokenIndex,
    }),
    tokenIndex: x.tokenIndex,
    tokenId: x.tokenId,
    artistName: x.artistName,
    aspectRatio: x.aspectRatio,
    contractAddress: bufToAddress(x.contractAddress),
    bid: highBidForToken(x.tokenId),
  }));
}

async function tokenHistory({ client, tokenId }) {
  const transfers = await eth.getTransfersForToken({
    client,
    tokenId,
  });
  const archipelagoSales = await eth.fillsByToken({ client, tokenId });
  const openseaSales = await openseaApi.salesByToken({ client, tokenId });

  // Map from transaction hash to `{ transfers, openseaSales }` in that
  // transaction. Map insertion order is semantic, as is order of the lists in
  // each entry.
  const txEvents = new Map();
  function txEventsEntry(tx) {
    let result = txEvents.get(tx);
    if (result == null) {
      result = { transfers: [], sales: [] };
      txEvents.set(tx, result);
    }
    return result;
  }
  for (const t of transfers) {
    txEventsEntry(t.transactionHash).transfers.push(t);
  }
  for (const s of archipelagoSales) {
    txEventsEntry(s.transactionHash).sales.push({ venue: "ARCHIPELAGO", ...s });
  }
  for (const s of openseaSales) {
    txEventsEntry(s.transactionHash).sales.push({ venue: "OPENSEA", ...s });
  }

  const result = [];
  function addTransfer(transfer) {
    result.push({ type: "TRANSFER", ...transfer });
  }
  function addSale(sale) {
    result.push({
      // TODO(@wchargin): Standardize as `type: "SALE"` once the frontend can
      // support that.
      type: sale.venue === "OPENSEA" ? "OPENSEA_SALE" : "SALE",
      ...sale,
    });
  }
  for (const events of txEvents.values()) {
    // When a transaction has exactly one transfer and exactly one sale, and
    // the two have the same sender and recipient, only add the sale.
    if (events.transfers.length === 1 && events.sales.length === 1) {
      const transfer = events.transfers[0];
      const sale = events.sales[0];
      if (transfer.from === sale.from && transfer.to === sale.to) {
        addSale(sale);
        continue;
      }
    }
    // Otherwise, add all the transfers (in `logIndex` order), followed by all
    // the OpenSea events (in OpenSea event order: arbitrary but stable).
    events.transfers.forEach(addTransfer);
    events.sales.forEach(addSale);
  }
  return result;
}

async function transferCount({ client, fromAddress, toAddress }) {
  const count = await eth.getTransferCount({
    client,
    fromAddress,
    toAddress,
  });
  return {
    transfers: count,
  };
}

async function lastSalesByProject({ client, projectId }) {
  return await eth.lastFillsByProject({ client, projectId });
}

// Adds a new email address to the signups list. Returns `true` if this made a
// change or `false` if the email already existed in the database. Idempotent.
async function addEmailSignup({ client, email }) {
  return emails.addEmailSignup({ client, email });
}

function formatImageUrl({ template, size, tokenIndex }) {
  let result = template;
  result = result.replace(PARAM_BASE_URL, IMAGE_BASE_URL);
  if (size != null) {
    result = result.replace(PARAM_SIZE, size);
  }
  if (tokenIndex != null) {
    const lo = String(tokenIndex % 1000).padStart(3, "0");
    const hi = String(Math.floor(tokenIndex / 1000)).padStart(3, "0");
    result = result.replace(PARAM_INDEX_LOW, lo).replace(PARAM_INDEX_HIGH, hi);
  }
  return result;
}

module.exports = {
  artblocksProjectIdToCollectionName,
  collectionNameToArtblocksProjectId,
  tokenIdBySlugAndIndex,
  resolveProjectId,
  resolveTraitIds,
  addCnf: cnfs.addCnf,
  getCnfTraits,
  getTraitData,
  blockAlignedTraitMembers,
  collections,
  collection,
  collectionTokens,
  projectFeaturesAndTraits,
  tokenFeaturesAndTraits,
  tokenChainData,
  tokenSummariesByOnChainId,
  tokenSummariesByAccount,
  tokenHistory,
  transferCount,
  lastSalesByProject,
  addEmailSignup,
  getWebsocketMessages: ws.getMessages,
  formatImageUrl,

  opensea: openseaApi,
  tokens: dbTokens,
  accounts,
  orderbook,
};
