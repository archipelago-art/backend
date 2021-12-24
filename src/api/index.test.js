const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const opensea = require("../db/opensea");
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
          maxInvocations: 10000,
          slug: "chromie-squiggle",
        },
        {
          id: "ab-23",
          name: "Archetype",
          artistName: "Kjetil Golid",
          description: expect.stringContaining("repetition as a counterweight"),
          aspectRatio: 1,
          numTokens: 1,
          maxInvocations: 600,
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
        maxInvocations: 600,
        slug: "archetype",
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
      const tokenNewid = await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.tokenNewidBySlugAndIndex({
        client,
        slug: "archetype",
        tokenIndex: 250,
      });
      expect(res).toEqual(tokenNewid);
    })
  );

  it(
    "provides project features and traits by ID or by newid",
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
      const newids = new Map();
      for (const tokenId of snapshots.TOKENS) {
        const rawTokenData = await sc.token(tokenId);
        const newid = await artblocks.addToken({
          client,
          tokenId,
          rawTokenData,
        });
        newids.set(tokenId, newid);
      }
      const res = await api.projectFeaturesAndTraits({ client, collection });
      expect(res).toEqual(
        expect.arrayContaining([
          {
            name: "Scene",
            id: expect.any(Number),
            featureNewid: expect.any(String),
            slug: "scene",
            traits: expect.arrayContaining([
              {
                value: "Cube",
                id: expect.any(Number),
                traitNewid: expect.any(String),
                tokens: [snapshots.THE_CUBE],
                tokenNewids: [newids.get(snapshots.THE_CUBE)],
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
      const tokenNewid = await artblocks.addToken({
        client,
        tokenId,
        rawTokenData,
      });
      const res1 = await api.tokenFeaturesAndTraits({ client, tokenId });
      expect(res1).toEqual(
        expect.arrayContaining([
          {
            name: "Framed",
            featureId: expect.any(Number),
            featureNewid: expect.any(String),
            featureSlug: "framed",
            value: "Yep",
            traitId: expect.any(Number),
            traitNewid: expect.any(String),
            traitSlug: "yep",
          },
          {
            name: "Scene",
            featureId: expect.any(Number),
            featureNewid: expect.any(String),
            featureSlug: "scene",
            value: "Cube",
            traitId: expect.any(Number),
            traitNewid: expect.any(String),
            traitSlug: "cube",
          },
        ])
      );
      const res2 = await api.tokenFeaturesAndTraitsByNewid({
        client,
        tokenNewid,
      });
      expect(res2).toEqual(res1);
    })
  );

  it(
    "provides summaries for multiple tokens",
    withTestDb(async ({ client }) => {
      for (const id of [snapshots.ARCHETYPE, snapshots.SQUIGGLES]) {
        const project = parseProjectData(id, await sc.project(id));
        await artblocks.addProject({ client, project });
      }
      const newids = new Map();
      for (const id of [snapshots.THE_CUBE, snapshots.PERFECT_CHROMATIC]) {
        const rawTokenData = await sc.token(id);
        const newid = await artblocks.addToken({
          client,
          tokenId: id,
          rawTokenData,
        });
        newids.set(id, newid);
      }
      const result = await api.tokenSummaries({
        client,
        tokenIds: [snapshots.THE_CUBE, snapshots.PERFECT_CHROMATIC],
      });
      expect(result).toEqual([
        {
          tokenId: snapshots.PERFECT_CHROMATIC,
          tokenNewid: newids.get(snapshots.PERFECT_CHROMATIC),
          name: "Chromie Squiggle",
          slug: "chromie-squiggle",
          artistName: "Snowfro",
          aspectRatio: 1.5,
        },
        {
          tokenId: snapshots.THE_CUBE,
          tokenNewid: newids.get(snapshots.THE_CUBE),
          name: "Archetype",
          slug: "archetype",
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

  it(
    "computes aggregated opensea sale data per project",
    withTestDb(async ({ client }) => {
      // Copied from db/artblocks.test.js
      const sc = new snapshots.SnapshotCache();
      async function addProjects(client, projectIds) {
        const projects = await Promise.all(
          projectIds.map(async (id) =>
            parseProjectData(id, await sc.project(id))
          )
        );
        const result = [];
        for (const project of projects) {
          const newid = await artblocks.addProject({ client, project });
          result.push(newid);
        }
        return result;
      }
      async function addTokens(client, tokenIds) {
        const tokens = await Promise.all(
          tokenIds.map(async (id) => ({
            tokenId: id,
            rawTokenData: await sc.token(id),
          }))
        );
        for (const { tokenId, rawTokenData } of tokens) {
          await artblocks.addToken({ client, tokenId, rawTokenData });
        }
        return tokens;
      }
      const [archetypeId, squiggleId] = await addProjects(client, [
        snapshots.ARCHETYPE,
        snapshots.SQUIGGLES,
      ]);
      await addTokens(client, [
        snapshots.THE_CUBE,
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.PERFECT_CHROMATIC,
      ]);

      const s1 = {
        eventId: "1",
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        tokenId: String(snapshots.THE_CUBE),
        saleTime: new Date("2021-01-01"),
        price: "3300",
        currencyContract: "0x0000000000000000000000000000000000000000",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      const s2 = {
        eventId: "2",
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
        tokenId: String(snapshots.PERFECT_CHROMATIC),
        saleTime: new Date("2021-02-01"),
        price: "1000",
        currencyContract: opensea.WETH_ADDRESS,
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      const s3 = {
        eventId: "3",
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        tokenId: String(snapshots.THE_CUBE),
        saleTime: new Date("2021-02-02"),
        price: "1234",
        currencyContract: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      const s4 = {
        eventId: "4",
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        tokenId: String(snapshots.ARCH_TRIPTYCH_1),
        saleTime: new Date("2021-05-01"),
        price: "1000",
        currencyContract: "0x0000000000000000000000000000000000000000",
        buyerAddress: "0x3333333333333333333333333333333333333333",
        sellerAddress: "0x4444444444444444444444444444444444444444",
      };
      await opensea.addSales({ client, sales: [s1, s2, s3, s4] });
      const result1 = await api.openseaSalesByProject({
        client,
        afterDate: new Date("2021-01-01"),
      });
      // archetype has 4300n sales because the third sale was on a non-ETH currency
      const archExpected1 = {
        slug: "archetype",
        projectId: archetypeId,
        totalEthSales: 4300n,
      };
      const squiggleExpected = {
        slug: "chromie-squiggle",
        projectId: squiggleId,
        totalEthSales: 1000n,
      };
      expect(result1).toEqual([archExpected1, squiggleExpected]);
      const result2 = await api.openseaSalesByProject({
        client,
        afterDate: new Date("2021-05-01"),
      });
      const archExpected2 = {
        slug: "archetype",
        projectId: archetypeId,
        totalEthSales: 1000n,
      };
      expect(result2).toEqual([archExpected2]);
    })
  );
});
