const { acqrel, bufToAddress } = require("./util");
const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const autoglyphs = require("./autoglyphs");
const tokens = require("./tokens");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const adHocPromise = require("../util/adHocPromise");

describe("db/tokens", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProjects(client, projectIds) {
    const projects = await Promise.all(
      projectIds.map(async (id) => parseProjectData(id, await sc.project(id)))
    );
    const result = [];
    for (const project of projects) {
      const id = await artblocks.addProject({ client, project });
      result.push({ project, id });
    }
    return result;
  }
  async function addTokens(client, tokenIds) {
    const tokens = await Promise.all(
      tokenIds.map(async (id) => ({
        artblocksTokenId: id,
        rawTokenData: await sc.token(id),
      }))
    );
    const result = [];
    for (const { artblocksTokenId, rawTokenData } of tokens) {
      const id = await artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData,
      });
      result.push({ artblocksTokenId, rawTokenData, id });
    }
    return result;
  }

  it(
    "supports tokenSummariesByOnChainId",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      await autoglyphs.addAutoglyphs({ client });
      const tokenId1 = snapshots.ARCH_TRIPTYCH_1;
      await addTokens(client, [tokenId1]);
      const res = await tokens.tokenSummariesByOnChainId({
        client,
        tokens: [
          { address: artblocks.CONTRACT_ARTBLOCKS_STANDARD, tokenId: tokenId1 },
          { address: autoglyphs.CONTRACT_ADDRESS, tokenId: 2 },
        ],
      });
      expect(res).toEqual([
        {
          name: "Archetype",
          artistName: "Kjetil Golid",
          slug: "archetype",
          imageTemplate: "{baseUrl}/artblocks/{sz}/23/{hi}/{lo}",
          tokenIndex: 36,
          aspectRatio: 1,
        },
        {
          name: "Autoglyphs",
          artistName: "Larva Labs",
          slug: "autoglyphs",
          imageTemplate: "{baseUrl}/autoglyphs/svg/{lo}",
          tokenIndex: 2,
          aspectRatio: 1,
        },
      ]);
    })
  );
});
