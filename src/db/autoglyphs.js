const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);
const { newId, newIds, ObjectType } = require("./id");
const { hexToBuf } = require("./util");
const channels = require("./channels");

const CONTRACT_ADDRESS = require("../api/contracts").autoglyphs.address;

async function addAutoglyphs({ client }) {
  await client.query("BEGIN");
  const projectId = newId(ObjectType.PROJECT);

  const description =
    "Autoglyphs are the first “on-chain” generative art on the Ethereum blockchain. They are a completely self-contained mechanism for the creation and ownership of an artwork.";
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
      'Autoglyphs',
      512,
      'Larva Labs',
      $2,
      1,
      512,
      'autoglyphs',
      $3,
      '{baseUrl}/autoglyphs/svg/{lo}'
    )
    `,
    [projectId, description, hexToBuf(CONTRACT_ADDRESS)]
  );

  const tokenIds = newIds(512, ObjectType.TOKEN);
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
      generate_series(1, 512),
      $3,
      generate_series(1, 512)
    )
    `,
    [tokenIds, projectId, hexToBuf(CONTRACT_ADDRESS)]
  );

  await channels.newTokens.sendMany(
    client,
    tokenIds.map((tokenId) => ({ projectId, tokenId }))
  );

  const featureId = newId(ObjectType.FEATURE);
  await client.query(
    `
    INSERT INTO features (feature_id, project_id, name)
      VALUES ($1, $2, 'Symbol Scheme')
    `,
    [featureId, projectId]
  );

  const traitIds = newIds(10, ObjectType.TRAIT);
  const traitValues = [
    "#1",
    "#2",
    "#3",
    "#4",
    "#5",
    "#6",
    "#7",
    "#8",
    "#9",
    "#10",
  ];
  await client.query(
    `
    INSERT INTO traits (trait_id, feature_id, value)
      VALUES (unnest($1::traitid[]), $2, unnest($3::text[]))
    `,
    [traitIds, featureId, traitValues]
  );

  const traits = schemes.map((x) => traitIds[x - 1]);

  await client.query(
    `
    INSERT INTO trait_members (trait_id, token_id) VALUES
      (
        unnest($1::traitid[]),
        unnest($2::tokenid[])
      )
    `,
    [traits, tokenIds]
  );
  await client.query("COMMIT");
  return projectId;
}

const schemes = [
  5, 1, 2, 4, 1, 1, 2, 4, 2, 3, 3, 3, 5, 9, 2, 1, 10, 3, 1, 6, 4, 9, 8, 8, 3, 3,
  6, 8, 4, 1, 5, 3, 5, 4, 1, 1, 9, 6, 3, 9, 9, 4, 1, 2, 1, 5, 1, 5, 6, 3, 3, 9,
  8, 1, 3, 3, 1, 1, 5, 3, 1, 4, 3, 3, 4, 7, 2, 5, 2, 3, 2, 5, 1, 5, 7, 2, 1, 2,
  1, 3, 4, 1, 1, 4, 6, 3, 10, 1, 2, 6, 10, 2, 2, 1, 5, 2, 4, 3, 4, 5, 1, 5, 8,
  1, 3, 5, 1, 1, 6, 1, 9, 5, 1, 1, 1, 1, 1, 9, 3, 6, 2, 9, 3, 6, 7, 3, 5, 2, 8,
  4, 1, 1, 5, 2, 1, 2, 5, 4, 2, 5, 1, 1, 5, 8, 1, 4, 3, 1, 9, 5, 1, 3, 3, 3, 1,
  1, 8, 7, 6, 2, 1, 4, 3, 1, 2, 2, 1, 5, 6, 1, 1, 2, 5, 1, 6, 5, 7, 2, 1, 1, 2,
  2, 2, 4, 4, 4, 6, 5, 6, 6, 1, 1, 4, 3, 6, 8, 7, 1, 3, 2, 4, 4, 1, 4, 10, 2, 3,
  2, 1, 2, 2, 3, 2, 1, 7, 7, 3, 2, 4, 1, 5, 2, 7, 2, 3, 1, 4, 3, 2, 3, 5, 1, 7,
  4, 2, 1, 3, 3, 6, 4, 5, 4, 1, 1, 6, 3, 2, 2, 1, 2, 5, 4, 2, 2, 4, 1, 2, 4, 2,
  1, 1, 3, 1, 7, 1, 7, 4, 5, 1, 4, 2, 5, 3, 5, 3, 2, 6, 2, 8, 2, 8, 2, 5, 4, 3,
  5, 6, 8, 4, 3, 3, 2, 1, 4, 1, 3, 3, 5, 3, 2, 5, 4, 3, 1, 7, 1, 4, 1, 9, 1, 10,
  4, 2, 1, 3, 3, 1, 6, 1, 2, 2, 5, 1, 1, 4, 4, 1, 1, 2, 6, 4, 2, 3, 8, 1, 1, 2,
  3, 7, 1, 1, 3, 5, 3, 1, 1, 1, 5, 5, 1, 1, 2, 3, 4, 1, 2, 4, 2, 3, 4, 5, 2, 1,
  3, 1, 2, 3, 3, 1, 5, 2, 7, 4, 1, 2, 3, 4, 4, 6, 3, 2, 3, 1, 3, 6, 4, 2, 2, 2,
  4, 8, 2, 6, 2, 7, 6, 3, 7, 5, 3, 5, 2, 1, 6, 4, 5, 1, 2, 5, 4, 1, 2, 2, 4, 5,
  7, 2, 1, 2, 7, 2, 8, 4, 1, 3, 5, 4, 8, 4, 5, 5, 2, 2, 3, 4, 5, 2, 2, 4, 1, 3,
  1, 5, 3, 1, 4, 2, 1, 2, 10, 2, 3, 4, 7, 3, 1, 4, 2, 2, 4, 1, 1, 3, 4, 3, 3, 7,
  2, 2, 4, 1, 1, 3, 1, 1, 1, 1, 5, 2, 1, 2, 2, 4, 10, 7, 2, 2, 10, 3, 3, 2, 1,
  6, 1, 1, 3, 4, 2, 7, 2, 6, 5, 5, 2, 2, 2, 2, 1, 2, 1, 2, 6,
];

module.exports = { addAutoglyphs, CONTRACT_ADDRESS };
