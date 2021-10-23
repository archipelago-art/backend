const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");

describe("db/artblocks", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const project = {
        projectId: 23,
        artistName: "Kjetil Golid",
        name: "Archetype",
        maxInvocations: 600,
        description: snapshots.ARCHETYPE_DESCRIPTION,
        scriptJson: {
          type: "p5js",
          version: "1.0.0",
          aspectRatio: "1",
          curation_status: "curated",
        },
        aspectRatio: 1,
        numTokens: 0,
        slug: "archetype",
      };
      await artblocks.addProject({
        client,
        project: parseProjectData(
          snapshots.ARCHETYPE,
          await sc.project(snapshots.ARCHETYPE)
        ),
      });
      expect(
        await artblocks.getProject({ client, projectId: snapshots.ARCHETYPE })
      ).toEqual(project);
    })
  );

  it(
    "fails on duplicate project ID",
    withTestDb(async ({ client }) => {
      const project = {
        projectId: 23,
        name: "Archetype",
        maxInvocations: 600,
        scriptJson: JSON.stringify({ aspectRatio: "3/2" }),
      };
      await artblocks.addProject({ client, project });
      await expect(artblocks.addProject({ client, project })).rejects.toThrow();
    })
  );

  it(
    "populates `num_tokens` when tokens already exist",
    withTestDb(async ({ client }) => {
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: await sc.token(snapshots.THE_CUBE),
      });
      await artblocks.addProject({
        client,
        project: parseProjectData(
          snapshots.ARCHETYPE,
          await sc.project(snapshots.ARCHETYPE)
        ),
      });
      expect(
        await artblocks.getProject({ client, projectId: snapshots.ARCHETYPE })
      ).toEqual(
        expect.objectContaining({
          projectId: 23,
          numTokens: 1,
        })
      );
    })
  );

  it(
    "inserts token data for successful fetches",
    withTestDb(async ({ client }) => {
      await artblocks.addProject({
        client,
        project: parseProjectData(
          snapshots.ARCHETYPE,
          await sc.project(snapshots.ARCHETYPE)
        ),
      });
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: await sc.token(snapshots.THE_CUBE),
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
      expect(
        await artblocks.getProject({ client, projectId: snapshots.ARCHETYPE })
      ).toEqual(
        expect.objectContaining({
          numTokens: 1,
        })
      );
    })
  );

  it(
    'inserts token data when "features" is an array',
    withTestDb(async ({ client }) => {
      await artblocks.addToken({
        client,
        tokenId: snapshots.GALAXISS_ZERO,
        rawTokenData: await sc.token(snapshots.GALAXISS_ZERO),
      });
      const actualFeatures = await artblocks.getTokenFeatures({
        client,
        tokenId: snapshots.GALAXISS_ZERO,
      });
      const expectedFeatures = [
        "0: Pleasant palette",
        "1: Night theme",
        "2: 4 clouds",
      ];
      expect(actualFeatures.slice().sort()).toEqual(
        expectedFeatures.slice().sort()
      );
    })
  );

  it(
    "inserts data whose features are strings, numbers, or null",
    withTestDb(async ({ client }) => {
      await artblocks.addToken({
        client,
        tokenId: snapshots.BYTEBEATS_SEVEN,
        rawTokenData: await sc.token(snapshots.BYTEBEATS_SEVEN),
      });
      const actualFeatures = await artblocks.getTokenFeatures({
        client,
        tokenId: snapshots.BYTEBEATS_SEVEN,
      });
      const expectedFeatures = [
        "Tint: Electric",
        "Family: Powerclimb",
        "Visual: Waveform",
        "Sample Rate: 4978",
        "Progressions: null",
      ];
      expect(actualFeatures.slice().sort()).toEqual(
        expectedFeatures.slice().sort()
      );
    })
  );

  it(
    'rejects token data when "features" is not an array or object',
    withTestDb(async ({ client }) => {
      const tokenId = 999000000;
      const rawTokenData = JSON.stringify({ features: "hmm" });
      await expect(
        artblocks.addToken({
          client,
          tokenId,
          rawTokenData,
        })
      ).rejects.toEqual(
        expect.objectContaining({
          code: "22023",
          message: "cannot deconstruct a scalar",
        })
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
    "computes unfetched token IDs for a single project",
    withTestDb(async ({ client }) => {
      const projectId = 12;
      const baseTokenId = projectId * 1e6;
      const maxInvocations = 6;
      const scriptJson = JSON.stringify({ aspectRatio: "1" });
      await artblocks.addProject({
        client,
        project: { projectId, name: "Test", maxInvocations, scriptJson },
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
    const scriptJson = JSON.stringify({ aspectRatio: "1" });
    const projects = [
      { projectId: 1, name: "A", maxInvocations: 5, scriptJson },
      { projectId: 2, name: "B", maxInvocations: 5, scriptJson },
    ];
    const s = JSON.stringify;
    const tokens = [
      { tokenId: 1000000, rawTokenData: s({ features: { Size: "small" } }) },
      { tokenId: 1000001, rawTokenData: s({ features: { Size: "large" } }) },
      { tokenId: 1000002, rawTokenData: null },
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
    "computes unfetched token IDs across all projects",
    withTestDb(async ({ client }) => {
      const p1 = 1e6 * 1;
      const p2 = 1e6 * 2;
      await addTestData(client);
      expect(await artblocks.getAllUnfetchedTokenIds({ client })).toEqual([
        ...[p1 + 2, p1 + 3, p1 + 4],
        ...[p2 + 3, p2 + 4],
      ]);
    })
  );

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

  it(
    "doesn't permit updating token data",
    withTestDb(async ({ client }) => {
      await addTestData(client);
      await expect(() =>
        artblocks.addToken({
          client,
          tokenId: 1000001,
          rawTokenData: JSON.stringify({ features: { Size: "weird" } }),
        })
      ).rejects.toThrow('unique constraint "tokens_pkey"');
    })
  );

  it(
    "supports getProjectFeaturesAndTraits",
    withTestDb(async ({ client }) => {
      await artblocks.addProject({
        client,
        project: parseProjectData(
          snapshots.ARCHETYPE,
          await sc.project(snapshots.ARCHETYPE)
        ),
      });
      const tokenIds = [
        snapshots.THE_CUBE,
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
      ];
      for (const tokenId of tokenIds) {
        await artblocks.addToken({
          client,
          tokenId,
          rawTokenData: await sc.token(tokenId),
        });
      }
      const projectId = snapshots.ARCHETYPE;
      const res = await artblocks.getProjectFeaturesAndTraits({
        client,
        projectId,
      });
      const id = expect.any(Number);
      const expected = [
        {
          id,
          name: "Scene",
          traits: [
            { id, value: "Cube", tokens: [23000250] },
            { id, value: "Flat", tokens: [23000036, 23000045, 23000467] },
          ],
        },
        {
          id,
          name: "Framed",
          traits: [
            {
              id,
              value: "Yep",
              tokens: [23000036, 23000045, 23000250, 23000467],
            },
          ],
        },
        {
          id,
          name: "Layout",
          traits: [
            { id, value: "Chaos", tokens: [23000250] },
            { id, value: "Order", tokens: [23000036, 23000045, 23000467] },
          ],
        },
        {
          id,
          name: "Palette",
          traits: [
            {
              id,
              value: "Paddle",
              tokens: [23000036, 23000045, 23000250, 23000467],
            },
          ],
        },
        {
          id,
          name: "Shading",
          traits: [
            { id, value: "Bright Morning", tokens: [23000250] },
            { id, value: "Noon", tokens: [23000036, 23000045, 23000467] },
          ],
        },
        {
          id,
          name: "Coloring strategy",
          traits: [
            { id, value: "Single", tokens: [23000250] },
            { id, value: "Random", tokens: [23000036] },
            { id, value: "Group", tokens: [23000045, 23000467] },
          ],
        },
      ];
      expect(res).toEqual(expected);
      const featureIds = res.map((f) => f.id);
      expect(featureIds).toEqual(Array.from(new Set(featureIds)));
      const traitIds = res.flatMap((f) => f.traits.map((t) => t.id));
      expect(traitIds).toEqual(Array.from(new Set(traitIds)));
    })
  );
});
