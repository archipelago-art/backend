const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const snapshots = require("../scrape/snapshots");
const { parseTokenData } = require("../scrape/fetchArtblocksToken");

describe("db/artblocks", () => {
  const withTestDb = testDbProvider();
  let theCubeRaw;
  beforeAll(async () => {
    theCubeRaw = await snapshots.readToken(snapshots.THE_CUBE);
  });

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const project = {
        projectId: 23,
        name: "Archetype",
        maxInvocations: 600,
      };
      await artblocks.addProject({ client, project });
      expect(await artblocks.getProject({ client, projectId: 23 })).toEqual(
        project
      );
    })
  );

  it(
    "fails on duplicate project ID",
    withTestDb(async ({ client }) => {
      const project = {
        projectId: 23,
        name: "Archetype",
        maxInvocations: 600,
      };
      await artblocks.addProject({ client, project });
      await expect(artblocks.addProject({ client, project })).rejects.toThrow();
    })
  );

  it(
    "inserts token data for successful fetches",
    withTestDb(async ({ client }) => {
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: theCubeRaw,
      });
      const actualFeatures = await artblocks.getTokenFeatures({
        client,
        tokenId: snapshots.THE_CUBE,
      });
      const expectedFeatures = [
        "Scene: Cube",
        "Framed: Yep",
        "Layout: Chaos",
        "Palette: Paddle",
        "Shading: Bright Morning",
        "Coloring strategy: Single",
      ];
      expect(actualFeatures.slice().sort()).toEqual(
        expectedFeatures.slice().sort()
      );
    })
  );

  it(
    "inserts token data for 404s",
    withTestDb(async ({ client }) => {
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: null,
      });
      const actualFeatures = await artblocks.getTokenFeatures({
        client,
        tokenId: snapshots.THE_CUBE,
      });
      expect(actualFeatures).toEqual([]);
    })
  );

  it(
    "computes unfetched token IDs",
    withTestDb(async ({ client }) => {
      const projectId = 12;
      const baseTokenId = projectId * 1e6;
      const maxInvocations = 6;
      await artblocks.addProject({
        client,
        project: { projectId, name: "Test", maxInvocations },
      });
      await artblocks.addToken({
        client,
        tokenId: baseTokenId + 2,
        rawTokenData: JSON.stringify({ features: {} }),
      });
      await artblocks.addToken({
        client,
        tokenId: baseTokenId + 4,
        rawTokenData: null,
      });
      expect(
        await artblocks.getUnfetchedTokenIds({ client, projectId })
      ).toEqual([0, 1, 3, 4, 5].map((i) => baseTokenId + i));
    })
  );

  async function addTestData(client) {
    const projects = [
      { projectId: 1, name: "A", maxInvocations: 5 },
      { projectId: 2, name: "B", maxInvocations: 5 },
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
    await Promise.all(
      projects.map((p) => artblocks.addProject({ client, project: p }))
    );
    await Promise.all(
      tokens.map((t) =>
        artblocks.addToken({
          client,
          tokenId: t.tokenId,
          rawTokenData: t.rawTokenData,
        })
      )
    );
  }

  it(
    "finds tokens with a feature within a project",
    withTestDb(async ({ client }) => {
      await addTestData(client);
      expect(
        await artblocks.getTokensWithFeature({
          client,
          projectId: 2,
          featureName: "Size: small",
        })
      ).toEqual([2000000, 2000002]);
    })
  );

  it(
    "finds features of a project",
    withTestDb(async ({ client }) => {
      await addTestData(client);
      const features = await artblocks.getProjectFeatures({
        client,
        projectId: 2,
      });
      expect(features).toEqual(
        [
          "Size: small",
          "Size: large",
          "Color: red",
          "Color: green",
          "Color: blue",
        ].sort()
      );
    })
  );
});
