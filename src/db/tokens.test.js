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

  async function getProject({ client, projectId }) {
    const res = await client.query(
      `
      SELECT
        project_id AS "projectId",
        name as "name",
        max_invocations AS "maxInvocations",
        artist_name AS "artistName",
        description AS "description",
        aspect_ratio AS "aspectRatio",
        num_tokens AS "numTokens",
        slug AS "slug",
        token_contract AS "tokenContract",
        image_template AS "imageTemplate"
      FROM projects
      WHERE project_id = $1
      `,
      [projectId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    row.tokenContract = bufToAddress(row.tokenContract);
    return row;
  }

  async function addTestData(client) {
    const scriptJson = JSON.stringify({ aspectRatio: "1" });
    const projects = [
      { projectId: 1, name: "A", maxInvocations: 5, scriptJson },
      { projectId: 2, name: "B", maxInvocations: 5, scriptJson },
    ];
    const s = JSON.stringify;
    const tokens = [
      { tokenId: 1000000, rawTokenData: s({ features: { Size: "small" } }) },
      { tokenId: 1000001, rawTokenData: s({ features: { Size: "large" } }) },
      {
        tokenId: 2000000,
        rawTokenData: s({ features: { Size: "small", Color: "red" } }),
      },
      {
        tokenId: 2000001,
        rawTokenData: s({ features: { Size: "large", Color: "green" } }),
      },
      {
        tokenId: 2000002,
        rawTokenData: s({ features: { Size: "small", Color: "blue" } }),
      },
    ];
    const projectIds = await Promise.all(
      projects.map((p) => artblocks.addProject({ client, project: p }))
    );
    await Promise.all(
      tokens.map((t) =>
        artblocks.addToken({
          client,
          artblocksTokenId: t.tokenId,
          rawTokenData: t.rawTokenData,
        })
      )
    );
    return projectIds;
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
