const artblocks = require("../db/artblocks");
const { acqrel, withPool } = require("../db/util");
const images = require("../img");
const log = require("../util/log")(__filename);

async function generateImage(args) {
  if (args.length !== 3) {
    throw new Error("usage: generate-image <slug> <token-index> <outfile>");
  }
  const [slug, rawTokenIndex, outfile] = args;
  const tokenIndex = Number(rawTokenIndex);
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0)
    throw new Error("expected tokenIndex argument; got: " + args[0]);

  const { generatorData, tokenData } = await withPool(async (pool) => {
    const projectId = await acqrel(pool, async (client) => {
      const res = await artblocks.getProjectIdBySlug({ client, slug });
      if (res == null) {
        throw new Error(`no project with slug "${slug}"`);
      }
      return res;
    });
    const generatorData = await acqrel(pool, (client) =>
      artblocks.getProjectScript({
        client,
        projectId,
      })
    );

    const artblocksProjectIndex = await acqrel(pool, async (client) => {
      const [res] = await artblocks.artblocksProjectIndicesFromIds({
        client,
        projectIds: [projectId],
      });
      if (res == null) {
        throw new Error(`project ${slug} is not an Art Blocks project`);
      }
      return res;
    });
    const hash = await acqrel(pool, (client) =>
      artblocks.getTokenHash({ client, slug, tokenIndex })
    );
    const tokenId =
      artblocksProjectIndex * artblocks.PROJECT_STRIDE + tokenIndex;
    const tokenData = { tokenId, hash };

    return { generatorData, tokenData };
  });

  await images.generate(generatorData, tokenData, outfile);
}

module.exports = generateImage;
