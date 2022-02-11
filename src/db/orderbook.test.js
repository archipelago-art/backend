const ethers = require("ethers");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const artblocks = require("./artblocks");
const cnfs = require("./cnfs");
const { addBid, addAsk, floorAsk, bidsForToken } = require("./orderbook");
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
        expect(await bidsForToken({ client, tokenId })).toEqual([bid]);
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
        expect(await bidsForToken({ client, tokenId })).toEqual([bid]);
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
        expect(await bidsForToken({ client, tokenId })).toEqual([bid]);
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
        expect(await bidsForToken({ client, tokenId })).toEqual([bid]);
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
        expect(await bidsForToken({ client, tokenId })).toEqual([bid]);
        // Manually set active=false so we can test the bidsForToken behavior
        await client.query(
          `
          UPDATE bids SET active = false WHERE bid_id = $1::bidid
          `,
          [bidId]
        );
        expect(await bidsForToken({ client, tokenId })).toEqual([]);
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
});
