const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);
const { newId, newIds, ObjectType } = require("./id");
const { hexToBuf } = require("./util");
const { newTokensChannel } = require("./artblocks");
const toadzTraits = require("./cryptoadzTraits.json");

function processToadzData(tokenIds) {
  // feature name to feature id
  const nameToId = new Map();
  // Map-of-maps; feature id to a map from trait values to trait ids
  const featureIdToValuesToIds = new Map();
  const features = []; // {featureId, name}
  const traits = []; // {featureId, traitId, value}
  const traitMembers = []; // {tokenId, traitId}
  for (let i = 0; i < 6969; i++) {
    const tokenId = tokenIds[i];
    const traitData = Object.entries(toadzTraits[i]).filter(
      (x) => x[0] !== "tokenId"
    );
    // Some data sources include this, OpenSea has it, and it *is* an interesting property
    // to bid against, etc.
    traitData.push(["# Traits", traitData.length]);

    for (const [name, value] of traitData) {
      let featureId = nameToId.get(name);
      if (featureId == null) {
        featureId = newId(ObjectType.FEATURE);
        nameToId.set(name, featureId);
        features.push({ featureId, name });
        featureIdToValuesToIds.set(featureId, new Map());
      }
      const valueToId = featureIdToValuesToIds.get(featureId);
      let traitId = valueToId.get(value);
      if (traitId == null) {
        traitId = newId(ObjectType.TRAIT);
        valueToId.set(value, traitId);
        traits.push({ traitId, featureId, value });
      }
      traitMembers.push({ tokenId, traitId });
    }
  }
  return { features, traits, traitMembers };
}

async function addCryptoadz({ client, testMode }) {
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

  const tokenIds = newIds(6969, ObjectType.TOKEN);
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
      generate_series(1, 6969),
      $3,
      generate_series(1, 6969)
    )
    `,
    [tokenIds, projectId, hexToBuf(contractAddress)]
  );

  await newTokensChannel.sendMany(
    client,
    tokenIds.map((tokenId) => ({ projectId, tokenId }))
  );

  const { features, traits, traitMembers } = processToadzData(tokenIds);
  const pluck = (xs, k) => xs.map((x) => x[k]);
  await client.query(
    `
    INSERT INTO features (project_id, feature_id, name)
    VALUES ($1::projectid, unnest($2::featureid[]), unnest($3::text[]))
    `,
    [projectId, pluck(features, "featureId"), pluck(features, "name")]
  );
  await client.query(
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
      pluck(traits, "value"),
    ]
  );
  await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id)
    VALUES (unnest($1::traitid[]), unnest($2::tokenid[]))
    `,
    [pluck(traitMembers, "traitId"), pluck(traitMembers, "tokenId")]
  );

  await client.query("COMMIT");
  return projectId;
}

module.exports = addCryptoadz;
