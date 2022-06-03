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
    "adds tokens to an existing project",
    withTestDb(async ({ client }) => {
      const [{ id: archetype }] = await addProjects(client, [
        snapshots.ARCHETYPE,
      ]);
      async function getTokenCount() {
        const res = await client.query(
          `
          SELECT
            (SELECT num_tokens FROM projects WHERE project_id = $1::projectid) AS a,
            (SELECT count(1)::int FROM tokens WHERE project_id = $1::projectid) AS b
          `,
          [archetype]
        );
        const { a, b } = res.rows[0];
        if (a !== b) throw new Error(`token count mismatch: ${a} !== ${b}`);
        return a;
      }
      async function getTokenId(onChainTokenId) {
        const tokenContract = artblocks.CONTRACT_ARTBLOCKS_STANDARD;
        return await tokens.tokenIdByChainData({
          client,
          tokenContract,
          onChainTokenId,
        });
      }
      expect(await getTokenCount()).toEqual(0);
      const tokenId1 = await tokens.addBareToken({
        client,
        projectId: archetype,
        tokenIndex: 250,
        onChainTokenId: snapshots.THE_CUBE,
      });
      expect(tokenId1).toEqual(expect.any(String));
      expect(await getTokenCount()).toEqual(1);

      expect(await getTokenId(snapshots.ARCH_66)).toEqual(null);
      const tokenId2 = await tokens.addBareToken({
        client,
        projectId: archetype,
        tokenIndex: 66,
        onChainTokenId: snapshots.ARCH_66,
      });
      expect(await getTokenCount()).toEqual(2);
      expect(tokenId2).toEqual(expect.any(String));
      expect(tokenId1).not.toEqual(tokenId2);
      expect(await getTokenId(snapshots.ARCH_66)).toEqual(tokenId2);
    })
  );

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
  it(
    "supports tokenInfoById",
    withTestDb(async ({ client }) => {
      await addProjects(client, [snapshots.ARCHETYPE]);
      const tokenId = snapshots.ARCH_TRIPTYCH_1;
      const [{ id: archipelagoTokenId }] = await addTokens(client, [tokenId]);
      const res = await tokens.tokenInfoById({
        client,
        tokenIds: [archipelagoTokenId],
      });
      expect(res).toEqual([
        {
          tokenId: archipelagoTokenId,
          slug: "archetype",
          tokenIndex: 36,
        },
      ]);
    })
  );
});
