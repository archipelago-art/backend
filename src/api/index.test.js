const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const emails = require("../db/emails");
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
      const id23 = await artblocks.addProject({ client, project: archetype });
      const id0 = await artblocks.addProject({ client, project: squiggles });
      await artblocks.addToken({
        client,
        artblocksTokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.collections({ client });
      expect(res).toEqual([
        {
          projectId: id0,
          slug: "chromie-squiggle",
          artblocksProjectIndex: 0,
          imageUrlTemplate: expect.stringContaining("/0/"),
          name: "Chromie Squiggle",
          artistName: "Snowfro",
          description: expect.stringContaining(
            "the soul of the Art Blocks platform"
          ),
          aspectRatio: 1.5,
          numTokens: 0,
          maxInvocations: 10000,
        },
        {
          projectId: id23,
          slug: "archetype",
          artblocksProjectIndex: 23,
          imageUrlTemplate: expect.stringContaining("/23/"),
          name: "Archetype",
          artistName: "Kjetil Golid",
          description: expect.stringContaining("repetition as a counterweight"),
          aspectRatio: 1,
          numTokens: 1,
          maxInvocations: 600,
        },
      ]);
      expect(
        api.formatImageUrl({
          template: res[0].imageUrlTemplate,
          size: "1200p",
          tokenIndex: 1234,
        })
      ).toEqual("https://img.archipelago.art/artblocks/1200p/0/001/234");
    })
  );

  it(
    "reads a single project from a multi-project DB",
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
      const projectId = await artblocks.addProject({
        client,
        project: archetype,
      });
      await artblocks.addProject({ client, project: squiggles });
      await artblocks.addToken({
        client,
        artblocksTokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.collection({ client, slug: "archetype" });
      expect(res).toEqual({
        projectId,
        slug: "archetype",
        artblocksProjectIndex: 23,
        imageUrlTemplate: expect.stringContaining("/23/"),
        name: "Archetype",
        artistName: "Kjetil Golid",
        description: expect.stringContaining("repetition as a counterweight"),
        aspectRatio: 1,
        numTokens: 1,
        maxInvocations: 600,
      });
    })
  );

  it(
    "resolves a token ID",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const theCube = await sc.token(snapshots.THE_CUBE);
      await artblocks.addProject({ client, project: archetype });
      const tokenId = await artblocks.addToken({
        client,
        artblocksTokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.tokenIdBySlugAndIndex({
        client,
        slug: "archetype",
        tokenIndex: 250,
      });
      expect(res).toEqual(tokenId);
    })
  );

  it(
    "provides project features and traits",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const collection = api.artblocksProjectIdToCollectionName(
        archetype.projectId
      );
      for (const projectId of snapshots.PROJECTS) {
        const project = parseProjectData(
          projectId,
          await sc.project(projectId)
        );
        await artblocks.addProject({ client, project });
      }
      const ids = new Map();
      for (const tokenId of snapshots.TOKENS) {
        const rawTokenData = await sc.token(tokenId);
        const id = await artblocks.addToken({
          client,
          artblocksTokenId: tokenId,
          rawTokenData,
        });
        ids.set(tokenId, id);
      }
      const res = await api.projectFeaturesAndTraits({
        client,
        slug: "archetype",
      });
      expect(res).toEqual(
        expect.arrayContaining([
          {
            name: "Scene",
            featureId: expect.any(String),
            slug: "scene",
            traits: expect.arrayContaining([
              {
                value: "Cube",
                traitId: expect.any(String),
                tokenIndices: [snapshots.THE_CUBE % 1e6],
                slug: "cube",
              },
            ]),
          },
        ])
      );
    })
  );

  it(
    "provides token features and traits",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const collection = api.artblocksProjectIdToCollectionName(
        archetype.projectId
      );
      const rawTokenData = await sc.token(snapshots.THE_CUBE);
      await artblocks.addProject({ client, project: archetype });
      const tokenId = await artblocks.addToken({
        client,
        artblocksTokenId: snapshots.THE_CUBE,
        rawTokenData,
      });
      const res = await api.tokenFeaturesAndTraits({ client, tokenId });
      expect(res).toEqual(
        expect.arrayContaining([
          {
            name: "Framed",
            featureId: expect.any(String),
            featureSlug: "framed",
            value: "Yep",
            traitId: expect.any(String),
            traitSlug: "yep",
          },
          {
            name: "Scene",
            featureId: expect.any(String),
            featureSlug: "scene",
            value: "Cube",
            traitId: expect.any(String),
            traitSlug: "cube",
          },
        ])
      );
    })
  );

  it(
    "provides summaries for multiple tokens",
    withTestDb(async ({ client }) => {
      for (const id of [snapshots.ARCHETYPE, snapshots.SQUIGGLES]) {
        const project = parseProjectData(id, await sc.project(id));
        await artblocks.addProject({ client, project });
      }
      const ids = new Map();
      for (const artblocksTokenId of [
        snapshots.THE_CUBE,
        snapshots.PERFECT_CHROMATIC,
      ]) {
        const rawTokenData = await sc.token(artblocksTokenId);
        const tokenId = await artblocks.addToken({
          client,
          artblocksTokenId,
          rawTokenData,
        });
        ids.set(artblocksTokenId, tokenId);
      }
      const result = await api.tokenSummariesByOnChainId({
        client,
        tokens: [
          {
            address: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
            tokenId: String(snapshots.PERFECT_CHROMATIC),
          },
          {
            address: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
            tokenId: String(snapshots.THE_CUBE),
          },
        ],
      });
      expect(result).toEqual([
        {
          tokenId: ids.get(snapshots.PERFECT_CHROMATIC),
          name: "Chromie Squiggle",
          slug: "chromie-squiggle",
          artblocksProjectIndex: 0,
          imageUrlTemplate: expect.stringContaining("/0/007/583"),
          tokenIndex: 7583,
          artistName: "Snowfro",
          aspectRatio: 1.5,
        },
        {
          tokenId: ids.get(snapshots.THE_CUBE),
          name: "Archetype",
          slug: "archetype",
          artblocksProjectIndex: 23,
          imageUrlTemplate: expect.stringContaining("/23/000/250"),
          tokenIndex: 250,
          artistName: "Kjetil Golid",
          aspectRatio: 1,
        },
      ]);
    })
  );

  it("exposes a trait-sorting function", () => {
    const input = [
      { id: 123, value: "1 in 23" },
      { id: 999, value: "1 in 9" },
      { id: 0, value: "1 in 100" },
    ];
    const output = api.sortAsciinumeric(input, (trait) => trait.value);
    expect(output).toEqual([
      { id: 999, value: "1 in 9" },
      { id: 123, value: "1 in 23" },
      { id: 0, value: "1 in 100" },
    ]);
  });

  it(
    "permits adding emails",
    withTestDb(async ({ client }) => {
      const email = "alice@example.com";
      expect(await api.addEmailSignup({ client, email })).toBe(true);
      expect(await emails.getEmailSignups({ client })).toEqual([
        { email, createTime: expect.any(Date) },
      ]);
    })
  );
});
