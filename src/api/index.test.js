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
      await artblocks.addProject({ client, project: archetype });
      await artblocks.addProject({ client, project: squiggles });
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.collection({ client, collection: "ab-23" });
      expect(res).toEqual({
        id: "ab-23",
        name: "Archetype",
        artistName: "Kjetil Golid",
        description: expect.stringContaining("repetition as a counterweight"),
        aspectRatio: 1,
        numTokens: 1,
        slug: "archetype",
      });
    })
  );

  it(
    "provides project mint state",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const theCube = await sc.token(snapshots.THE_CUBE);
      await artblocks.addProject({ client, project: archetype });
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.collectionMintState({
        client,
        collection: "ab-23",
      });
      expect(res).toEqual({
        numTokens: 1,
        maxInvocations: 600,
      });
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
        if (projectId === snapshots.PHANTOM_SEADRAGONS) continue;
        const project = parseProjectData(
          projectId,
          await sc.project(projectId)
        );
        await artblocks.addProject({ client, project });
      }
      for (const tokenId of snapshots.TOKENS) {
        const rawTokenData = await sc.token(tokenId);
        await artblocks.addToken({ client, tokenId, rawTokenData });
      }
      const res = await api.projectFeaturesAndTraits({ client, collection });
      expect(res).toEqual(
        expect.arrayContaining([
          {
            name: "Scene",
            id: expect.any(Number),
            slug: "scene",
            traits: expect.arrayContaining([
              {
                value: "Cube",
                id: expect.any(Number),
                tokens: [snapshots.THE_CUBE],
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
      const tokenId = snapshots.THE_CUBE;
      const rawTokenData = await sc.token(tokenId);
      await artblocks.addProject({ client, project: archetype });
      await artblocks.addToken({ client, tokenId, rawTokenData });
      const res = await api.tokenFeaturesAndTraits({ client, tokenId });
      expect(res).toEqual(
        expect.arrayContaining([
          {
            name: "Framed",
            featureId: expect.any(Number),
            featureSlug: "framed",
            value: "Yep",
            traitId: expect.any(Number),
            traitSlug: "yep",
          },
          {
            name: "Scene",
            featureId: expect.any(Number),
            featureSlug: "scene",
            value: "Cube",
            traitId: expect.any(Number),
            traitSlug: "cube",
          },
        ])
      );
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
