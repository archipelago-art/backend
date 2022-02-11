const ethers = require("ethers");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const artblocks = require("./artblocks");
const cnfs = require("./cnfs");
const {
  addBid,
  addAsk,
  floorAsk,
  bidDetailsForToken,
  highBidIdsForAllTokensInProject,
} = require("./orderbook");
const { testDbProvider } = require("./testUtil");

describe("db/orderbook", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProjects(client, projectIds) {
    const projects = await Promise.all(
      projectIds.map(async (id) => parseProjectData(id, await sc.project(id)))
    );
    const result = [];
    for (const project of projects) {
      const id = await artblocks.addProject({ client, project });
      result.push(id);
    }
    return result;
  }

  async function addTokens(client, artblocksTokenIds) {
    const tokens = await Promise.all(
      artblocksTokenIds.map(async (artblocksTokenId) => ({
        artblocksTokenId,
        rawTokenData: await sc.token(artblocksTokenId),
      }))
    );
    const result = [];
    for (const { artblocksTokenId, rawTokenData } of tokens) {
      const id = await artblocks.addToken({
        client,
        artblocksTokenId,
        rawTokenData,
      });
      result.push(id);
    }
    return result;
  }

  async function findTraitId(client, tokenId, featureName, traitValue) {
    const [{ traits }] = await artblocks.getTokenFeaturesAndTraits({
      client,
      tokenId,
    });
    const trait = traits.find(
      (t) => t.name === featureName && t.value === traitValue
    );
    if (trait == null) {
      throw new Error(
        `token ${tokenId} has no such trait: "${featureName}: ${traitValue}"`
      );
    }
    return trait.traitId;
  }

  async function getAsks(client) {
    const res = await client.query(`
      SELECT ask_id AS "askId", token_id AS "tokenId" FROM asks
    `);
    return res.rows;
  }
  async function isAskActive(client, askId) {
    const res = await client.query(
      `
      SELECT active FROM asks WHERE ask_id = $1::askid
      `,
      [askId]
    );
    if (res.rowCount !== 1) throw new Error(`no such ask: ${askId}`);
    return res.rows[0].active;
  }

  describe("addBid", () => {
    it(
      "adds a bid with project scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const bidder = ethers.constants.AddressZero;
        const bidId = await addBid({
          client,
          scope: { type: "PROJECT", projectId: archetype },
          price,
          deadline,
          bidder,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const bid = { bidId, price, bidder, deadline };
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
      })
    );

    it(
      "adds a bid with token scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const bidder = ethers.constants.AddressZero;
        const bidId = await addBid({
          client,
          scope: { type: "TOKEN", tokenId },
          price,
          deadline,
          bidder,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const bid = { bidId, price, bidder, deadline };
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
      })
    );

    it(
      "adds a bid with trait scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const bidder = ethers.constants.AddressZero;
        const traitData = await artblocks.getTokenFeaturesAndTraits({
          client,
          tokenId,
        });
        expect(traitData).toEqual([
          expect.objectContaining({
            tokenId,
            traits: expect.arrayContaining([
              expect.objectContaining({
                name: "Palette",
                value: "Paddle",
                traitId: expect.any(String),
              }),
            ]),
          }),
        ]);
        const { traitId } = traitData[0].traits.find(
          (t) => t.name === "Palette" && t.value === "Paddle"
        );
        const bidId = await addBid({
          client,
          scope: { type: "TRAIT", traitId },
          price,
          deadline,
          bidder,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const bid = { bidId, price, bidder, deadline };
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
      })
    );

    it(
      "adds a bid with CNF scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);

        const traitData = await artblocks.getTokenFeaturesAndTraits({
          client,
          tokenId,
        });
        const { traitId: palette } = traitData[0].traits.find(
          (t) => t.name === "Palette" && t.value === "Paddle"
        );
        const { traitId: shading } = traitData[0].traits.find(
          (t) => t.name === "Shading" && t.value === "Bright Morning"
        );
        const clauses = [[palette], [shading]];
        const cnfId = await cnfs.addCnf({ client, clauses });

        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const bidder = ethers.constants.AddressZero;
        const bidId = await addBid({
          client,
          scope: { type: "CNF", cnfId },
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const bid = { bidId, price, bidder, deadline };
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
      })
    );

    it(
      "always sets bids to active",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const deadline = new Date("2000-01-01"); // expired!
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const bidder = ethers.constants.AddressZero;
        const bidId = await addBid({
          client,
          scope: { type: "PROJECT", projectId: archetype },
          price: ethers.BigNumber.from("100"),
          deadline,
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const bid = { bidId, price, bidder, deadline };
        // Bid is included because it's (incorrectly) marked active (for now)
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
        // Manually set active=false so we can test the bidDetailsForToken behavior
        await client.query(
          `
          UPDATE bids SET active = false WHERE bid_id = $1::bidid
          `,
          [bidId]
        );
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([]);
      })
    );
  });

  describe("addAsk", () => {
    it(
      "adds an ask",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const askId = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        expect(await getAsks(client)).toEqual([{ askId, tokenId: theCube }]);
      })
    );

    it(
      "always sets asks to active",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const deadline = new Date("2000-01-01"); // expired!
        const askId = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const active = await isAskActive(client, askId);
        expect(active).toBe(true); // for now...
      })
    );
  });

  describe("floorAsk", () => {
    async function markInactive(client, askId) {
      await client.query(
        `
        UPDATE asks
        SET active = false
        WHERE ask_id = $1::askid
        `,
        [askId]
      );
    }

    it(
      "returns returns the lowest active ask on a project",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube, arch1] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
        ]);
        const deadline = new Date("2099-01-01");
        const ask1 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask2 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask3 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await markInactive(client, ask3);
        const floor = await floorAsk({ client, projectId: archetype });
        expect(floor).toEqual({
          askId: ask2,
          tokenId: arch1,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker: ethers.constants.AddressZero,
        });
      })
    );

    it(
      "returns returns the lowest active ask on a token",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube, arch1] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
        ]);
        const deadline = new Date("2099-01-01");
        const ask1 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask2 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask3 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await markInactive(client, ask3);
        const ask4 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const floor = await floorAsk({ client, tokenId: theCube });
        expect(floor).toEqual({
          askId: ask2,
          tokenId: theCube,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker: ethers.constants.AddressZero,
        });
      })
    );

    it(
      "returns null if no asks for that project",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const floor = await floorAsk({ client, projectId: archetype });
        expect(floor).toEqual(null);
      })
    );

    it(
      "returns null if no asks for that token",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const floor = await floorAsk({ client, tokenId: theCube });
        expect(floor).toEqual(null);
      })
    );
  });

  describe("highBidIdsForAllTokensInProject", () => {
    it(
      "handles all types of high bids, as well as absence of bid",
      withTestDb(async ({ client }) => {
        const [archetype, squiggles] = await addProjects(client, [
          snapshots.ARCHETYPE,
          snapshots.SQUIGGLES,
        ]);
        const [theCube, tri1, tri2, a66, aSquiggle] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
          snapshots.ARCH_66,
          snapshots.PERFECT_CHROMATIC,
        ]);

        const traitPaddle = await findTraitId(
          client,
          theCube,
          "Palette",
          "Paddle"
        );
        const traitRandom = await findTraitId(
          client,
          tri1,
          "Coloring strategy",
          "Random"
        );
        const traitCube = await findTraitId(client, theCube, "Scene", "Cube");

        async function makeBid({ scope, price }) {
          return await addBid({
            client,
            scope,
            price,
            deadline: new Date("2099-01-01"),
            bidder: ethers.constants.AddressZero,
            nonce: ethers.BigNumber.from("0xabcd").add(price),
            agreement: "0x",
            message: "0x",
            signature: "0x" + "fe".repeat(65),
          });
        }

        // Doesn't match any Archetypes.
        const bidFloorSquiggles = await makeBid({
          scope: { type: "PROJECT", projectId: squiggles },
          price: "100",
        });
        // Matches `theCube`, `tri1`, and `tri2` (not `a66`).
        const bidTraitPaddle = await makeBid({
          scope: { type: "TRAIT", traitId: traitPaddle },
          price: "300",
        });
        // Matches `theCube` and `tri1`.
        const cnfRandomOrCube = await cnfs.addCnf({
          client,
          clauses: [[traitRandom, traitCube]],
        });
        const bidCnfRandomOrCube = await makeBid({
          scope: { type: "CNF", cnfId: cnfRandomOrCube },
          price: "400",
        });
        // Matches `theCube` only.
        const bidTokenTheCube = await makeBid({
          scope: { type: "TOKEN", tokenId: theCube },
          price: "500",
        });

        const res1 = await highBidIdsForAllTokensInProject({
          client,
          projectId: archetype,
        });
        expect(res1).toEqual([
          { tokenId: theCube, bidId: bidTokenTheCube },
          { tokenId: tri1, bidId: bidCnfRandomOrCube },
          { tokenId: tri2, bidId: bidTraitPaddle },
          { tokenId: a66, bidId: null },
        ]);

        // Now, add an Archetype floor bid.
        const bidFloorArchetype = await makeBid({
          scope: { type: "PROJECT", projectId: archetype },
          price: "200",
        });

        const res2 = await highBidIdsForAllTokensInProject({
          client,
          projectId: archetype,
        });
        expect(res2).toEqual([
          { tokenId: theCube, bidId: bidTokenTheCube },
          { tokenId: tri1, bidId: bidCnfRandomOrCube },
          { tokenId: tri2, bidId: bidTraitPaddle },
          { tokenId: a66, bidId: bidFloorArchetype },
        ]);
      })
    );
  });
});
