const ethers = require("ethers");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const artblocks = require("./artblocks");
const { addBid, addAsk } = require("./orderbook");
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

  async function getBids(client) {
    const res = await client.query(`
      SELECT bid_id AS "bidId", scope AS "scope" FROM bids
    `);
    return res.rows;
  }
  async function isBidActive(client, bidId) {
    const res = await client.query(
      `
      SELECT active FROM bids WHERE bid_id = $1::bidid
      `,
      [bidId]
    );
    if (res.rowCount !== 1) throw new Error(`no such bid: ${bidId}`);
    return res.rows[0].active;
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
        const bidId = await addBid({
          client,
          scope: { type: "PROJECT", projectId: archetype },
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        expect(await getBids(client)).toEqual([{ bidId, scope: archetype }]);
      })
    );

    it(
      "adds a bid with token scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const bidId = await addBid({
          client,
          scope: { type: "TOKEN", tokenId: theCube },
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        expect(await getBids(client)).toEqual([{ bidId, scope: theCube }]);
      })
    );

    it(
      "adds a bid with trait scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const traitData = await artblocks.getTokenFeaturesAndTraits({
          client,
          tokenId: theCube,
        });
        expect(traitData).toEqual([
          expect.objectContaining({
            tokenId: theCube,
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
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        expect(await getBids(client)).toEqual([{ bidId, scope: traitId }]);
      })
    );

    it(
      "errors on CNF scope",
      withTestDb(async ({ client }) => {
        await expect(() =>
          addBid({
            client,
            scope: { type: "CNF" },
            price: ethers.BigNumber.from("100"),
            deadline: new Date("2099-01-01"),
            bidder: ethers.constants.AddressZero,
            nonce: ethers.BigNumber.from("0xabcd"),
            agreement: "0x",
            message: "0x",
            signature: "0x" + "fe".repeat(65),
          })
        ).rejects.toThrow("CNF scopes not implemented");
      })
    );

    it(
      "always sets bids to active",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const deadline = new Date("2000-01-01"); // expired!
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
        const bids = await getBids(client);
        const active = await isBidActive(client, bids[0].bidId);
        expect(active).toBe(true); // for now...
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
});
