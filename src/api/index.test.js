const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");

describe("api", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const squiggles = parseProjectData(
        snapshots.SQUIGGLES,
        await sc.project(snapshots.SQUIGGLES)
      );
      const theCube = await sc.token(snapshots.THE_CUBE);
      await artblocks.addProject({ client, project: archetype });
      await artblocks.addProject({ client, project: squiggles });
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.collections({ client });
      expect(res).toEqual([
        {
          id: "ab-0",
          name: "Chromie Squiggle",
          artistName: "Snowfro",
          description: expect.stringContaining(
            "the soul of the Art Blocks platform"
          ),
          aspectRatio: 1.5,
          numTokens: 0,
          slug: "chromie-squiggle",
        },
        {
          id: "ab-23",
          name: "Archetype",
          artistName: "Kjetil Golid",
          description: expect.stringContaining("repetition as a counterweight"),
          aspectRatio: 1,
          numTokens: 1,
          slug: "archetype",
        },
      ]);
    })
  );

  it(
    "provides tokenFeatures",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const collection = api.artblocksProjectIdToCollectionName(
        archetype.projectId
      );
      for (const tokenId of snapshots.TOKENS) {
        const rawTokenData = await sc.token(tokenId);
        await artblocks.addToken({ client, tokenId, rawTokenData });
      }
      const res = await api.tokenFeatures({ client, collection });
      const expected = {
        featureNames: [
          "Coloring strategy: Random",
          "Framed: Yep",
          "Layout: Order",
          "Palette: Paddle",
          "Scene: Flat",
          "Shading: Noon",
          "Coloring strategy: Group",
          "Coloring strategy: Single",
          "Layout: Chaos",
          "Scene: Cube",
          "Shading: Bright Morning",
        ],
        tokens: {
          23000036: [0, 1, 2, 3, 4, 5],
          23000045: [6, 1, 2, 3, 4, 5],
          23000250: [7, 1, 8, 3, 9, 10],
          23000467: [6, 1, 2, 3, 4, 5],
        },
      };
      expect(res).toEqual(expected);
    })
  );
});
