const api = require("../api");
const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);
const channels = require("./channels");
const { newId, newIds, ObjectType } = require("./id");
const tokens = require("./tokens");
const { hexToBuf } = require("./util");
const toadzSpecialTraits = require("./cryptoadzSpecialTraits.json");
const toadzTraits = require("./cryptoadzTraits.json");

const PROJECT_SLUG = "cryptoadz";

const CRYPTOADZ_CONTRACT = require("../api/contracts").cryptoadz.address;

function processToadzData(tokenIds) {
  // feature name to feature id
  const featureToId = new Map();
  // Map-of-maps; feature id to a map from trait values to trait ids
  const featureIdToTraitsToIds = new Map();
  const features = []; // {featureId, feature}
  const traits = []; // {featureId, traitId, trait}
  const traitMembers = []; // {tokenId, traitId}
  for (let i = 0; i < tokenIds.length; i++) {
    const toad = toadzTraits[i];
    if (toad.tokenId !== i + 1) {
      throw new Error(`tokenId mismatch: ${i + 1} vs ${toad.tokenId}`);
    }
    const tokenId = tokenIds[i];
    const attributes = toad.attributes;

    for (const { feature, trait } of attributes) {
      let featureId = featureToId.get(feature);
      if (featureId == null) {
        featureId = newId(ObjectType.FEATURE);
        featureToId.set(feature, featureId);
        features.push({ featureId, feature });
        featureIdToTraitsToIds.set(featureId, new Map());
      }
      const traitToId = featureIdToTraitsToIds.get(featureId);
      let traitId = traitToId.get(trait);
      if (traitId == null) {
        traitId = newId(ObjectType.TRAIT);
        traitToId.set(trait, traitId);
        traits.push({ traitId, featureId, trait });
      }
      traitMembers.push({ tokenId, traitId });
    }
  }
  return { features, traits, traitMembers };
}

async function fixCryptoadz({ client, testMode }) {
  await client.query("BEGIN");
  const projectIdRes = await client.query(
    `
    SELECT project_id AS "projectId"
    FROM projects
    WHERE slug=$1;
    `,
    [PROJECT_SLUG]
  );
  const projectId = projectIdRes.rows[0].projectId;
  const toadzIdsRes = await client.query(
    `SELECT token_id AS "tokenId", on_chain_token_id AS "onChainId"
    FROM tokens
    WHERE project_id=$1
    ORDER BY on_chain_token_id ASC`,
    [projectId]
  );
  const toadzIds = toadzIdsRes.rows;
  for (let i = 1; i <= 6969; i++) {
    if (toadzIds[i - 1].onChainId !== String(i)) {
      throw new Error(`toadz mismatch on ${i}`);
    }
  }
  const toadzTokenIds = toadzIds.map((x) => x.tokenId);

  const removeTraitMembers = await client.query(
    `
    DELETE FROM trait_members
    WHERE token_id = ANY($1::tokenid[])
    `,
    [toadzTokenIds]
  );
  log.info`trait_members removed: ${removeTraitMembers.rowCount}`;
  const featuresToRemoveRes = await client.query(
    `
    SELECT feature_id AS "featureId"
    FROM features
    WHERE project_id = $1
    `,
    [projectId]
  );
  const featuresToRemove = featuresToRemoveRes.rows.map((x) => x.featureId);
  const removeTraits = await client.query(
    `
    DELETE FROM traits
    WHERE feature_id = ANY($1::featureid[])
    `,
    [featuresToRemove]
  );
  log.info`traits removed: ${removeTraits.rowCount}`;
  const removeFeatures = await client.query(
    `
    DELETE FROM features
    WHERE project_id = $1
    `,
    [projectId]
  );
  log.info`features removed: ${removeFeatures.rowCount}`;
  await addCryptoadzTraitsAndFeatures({
    client,
    tokenIds: toadzTokenIds,
    projectId,
  });
  await client.query("COMMIT");
}

async function addCryptoadzTraitsAndFeatures({ client, tokenIds, projectId }) {
  const { features, traits, traitMembers } = processToadzData(tokenIds);
  const pluck = (xs, k) => xs.map((x) => x[k]);
  const featuresAdded = await client.query(
    `
    INSERT INTO features (project_id, feature_id, name)
    VALUES ($1::projectid, unnest($2::featureid[]), unnest($3::text[]))
    `,
    [projectId, pluck(features, "featureId"), pluck(features, "feature")]
  );
  log.info`features added: ${featuresAdded.rowCount}`;
  const traitsAdded = await client.query(
    `
    INSERT INTO traits (feature_id, trait_id, value)
    VALUES (
      unnest($1::featureid[]),
      unnest($2::traitid[]),
      unnest($3::text[])
    )
    `,
    [
      pluck(traits, "featureId"),
      pluck(traits, "traitId"),
      pluck(traits, "trait"),
    ]
  );
  log.info`traits added: ${traitsAdded.rowCount}`;
  const membersAdded = await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id)
    VALUES (unnest($1::traitid[]), unnest($2::tokenid[]))
    `,
    [pluck(traitMembers, "traitId"), pluck(traitMembers, "tokenId")]
  );
  log.info`members added: ${membersAdded.rowCount}`;
}

async function addCryptoadz({ client, testMode = false }) {
  const numTokens = testMode ? 5 : 6969;
  await client.query("BEGIN");
  const projectId = newId(ObjectType.PROJECT);

  const description = `CrypToadz are a collection 6969 small amphibious creatures trying to escape the tyrannical rule of the Evil King Gremplin. Created by Gremplin, with a small bit of help from his friends.

This project is in the public domain. Feel free to use the toadz in any way you want.`;
  const contractAddress = "0x1cb1a5e65610aeff2551a50f76a87a7d3fb649c6";
  await client.query(
    `
    INSERT INTO projects (
      project_id,
      name,
      max_invocations,
      artist_name,
      description,
      aspect_ratio,
      num_tokens,
      slug,
      token_contract,
      image_template
    ) VALUES (
      $1,
      'CrypToadz',
      6969,
      'GREMPLIN',
      $2,
      1,
      6969,
      'cryptoadz',
      $3,
      '{baseUrl}/cryptoadz/img/{hi}/{lo}'
    )
    `,
    [projectId, description, hexToBuf(contractAddress)]
  );

  const tokenIds = newIds(numTokens, ObjectType.TOKEN);
  await client.query(
    `
    INSERT INTO tokens (
      token_id,
      project_id,
      token_index,
      token_contract,
      on_chain_token_id
    ) VALUES (
      unnest($1::tokenid[]),
      $2,
      generate_series(1, $4),
      $3,
      generate_series(1, $4)
    )
    `,
    [tokenIds, projectId, hexToBuf(contractAddress), numTokens]
  );

  await channels.newTokens.sendMany(
    client,
    tokenIds.map((tokenId) => ({ projectId, tokenId }))
  );

  await addCryptoadzTraitsAndFeatures({ client, projectId, tokenIds });

  await client.query("COMMIT");
  return projectId;
}

async function addSpecialCryptoadz({ client }) {
  await client.query("BEGIN");
  const projectId = await api.resolveProjectId({ client, slug: PROJECT_SLUG });
  let n = 0;
  for (const row of toadzSpecialTraits) {
    const tokenId = await tokens.addBareToken({
      client,
      projectId,
      tokenIndex: row.tokenId,
      onChainTokenId: row.tokenId,
      alreadyInTransaction: true,
    });
    const featureData = {};
    for (const { feature, trait } of row.attributes) {
      featureData[feature] = trait;
    }
    await tokens.setTokenTraits({
      client,
      tokenId,
      featureData,
      alreadyInTransaction: true,
    });
    n++;
  }
  await client.query("COMMIT");
  return n;
}

module.exports = {
  addCryptoadz,
  fixCryptoadz,
  addSpecialCryptoadz,
  CRYPTOADZ_CONTRACT,
};
