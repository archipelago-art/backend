const { withClient } = require("../db/util");
const log = require("../util/log")(__filename);
const contracts = require("../api/contracts");
const { newId, newIds, ObjectType } = require("./id");
const { addProject } = require("./projects");
const { hexToBuf } = require("./util");

async function addMintPassProject({ client }) {
  const description =
    "QQL is a generative art NFT project by Tyler Hobbs and Dandelion Wist Mané that empowers collectors as co-creators.";
  await addProject({
    client,
    name: "QQL Mint Pass",
    maxInvocations: 999,
    artistName: "Tyler Hobbs x Dandelion Wist Mané",
    description,
    aspectRatio: 1,
    tokenContract: contracts.qqlMintPass.address,
    imageTemplate: "{baseUrl}/qql/mint-pass/{lo}",
  });
}

async function addMintPass({ client, onChainTokenId }) {
  await client.query("BEGIN");
  const projectId = await projectIdForSlug({ client, slug: "qql-mint-pass" });
  const tokenId = await tokens.addBareToken({
    client,
    projectId,
    onChainTokenId,
    tokenIndex: onChainTokenId,
    alreadyInTransaction: true,
  });
  await client.query("COMMIT");
  return tokenId;
}

module.exports = {
  addMintPassProject,
  addMintPass,
};
