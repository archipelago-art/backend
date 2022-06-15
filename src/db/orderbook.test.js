const ethers = require("ethers");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const adHocPromise = require("../util/adHocPromise");
const artblocks = require("./artblocks");
const cnfs = require("./cnfs");
const {
  addBid,
  addAsk,
  updateActivityForNonce,
  updateActivityForTokenOwners,
  floorAsk,
  floorAsks,
  floorAskIdsForAllTokensInProject,
  floorAskForEveryProject,
  askDetails,
  askDetailsForToken,
  askIdsForToken,
  bidDetailsForToken,
  bidIdsForAddress,
  askIdsForAddress,
  highBidIdsForAllTokensInProject,
} = require("./orderbook");
const { testDbProvider } = require("./testUtil");
const { acqrel } = require("./util");
const ws = require("./ws");

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

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          scope: { type: "PROJECT", projectId: archetype },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });

        const messages = await ws.getMessages({
          client,
          topic: "archetype",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "BID_PLACED",
              topic: "archetype",
              data: {
                bidId,
                projectId: archetype,
                slug: "archetype",
                scope: {
                  type: "PROJECT",
                  projectId: archetype,
                  slug: "archetype",
                },
                venue: "ARCHIPELAGO",
                bidder,
                nonce: nonce.toString(),
                currency: "ETH",
                price: String(price),
                timestamp: expect.any(String),
                expirationTime: deadline.toISOString(),
              },
            },
          ])
        );

        const bid = {
          bidId,
          slug: "archetype",
          name: "Archetype",
          price,
          bidder,
          nonce: nonce.toString(),
          deadline,
          signature: "0x" + "fe".repeat(65),
          message: "0x",
          agreement: "0x",
          scope: { type: "PROJECT", scope: archetype },
        };
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

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          scope: { type: "TOKEN", tokenId },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });

        const messages = await ws.getMessages({
          client,
          topic: "archetype",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "BID_PLACED",
              topic: "archetype",
              data: {
                bidId,
                projectId: archetype,
                slug: "archetype",
                scope: {
                  type: "TOKEN",
                  tokenIndex: 250,
                  tokenId,
                },
                venue: "ARCHIPELAGO",
                bidder,
                nonce: nonce.toString(),
                currency: "ETH",
                price: String(price),
                timestamp: expect.any(String),
                expirationTime: deadline.toISOString(),
              },
            },
          ])
        );

        const bid = {
          bidId,
          slug: "archetype",
          name: "Archetype",
          price,
          bidder,
          nonce: nonce.toString(),
          deadline,
          signature: "0x" + "fe".repeat(65),
          message: "0x",
          agreement: "0x",
          scope: { type: "TOKEN", scope: tokenId },
        };

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

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          scope: { type: "TRAIT", traitId },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });

        const messages = await ws.getMessages({
          client,
          topic: "archetype",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "BID_PLACED",
              topic: "archetype",
              data: {
                bidId,
                projectId: archetype,
                slug: "archetype",
                scope: {
                  type: "TRAIT",
                  traitId,
                  featureName: "Palette",
                  traitValue: "Paddle",
                },
                venue: "ARCHIPELAGO",
                bidder,
                nonce: nonce.toString(),
                currency: "ETH",
                price: String(price),
                timestamp: expect.any(String),
                expirationTime: deadline.toISOString(),
              },
            },
          ])
        );
        const bid = {
          bidId,
          slug: "archetype",
          name: "Archetype",
          price,
          bidder,
          nonce: nonce.toString(),
          deadline,
          signature: "0x" + "fe".repeat(65),
          message: "0x",
          agreement: "0x",
          scope: { type: "TRAIT", scope: traitId },
        };
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

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          scope: { type: "CNF", cnfId },
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          bidder: ethers.constants.AddressZero,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });

        const messages = await ws.getMessages({
          client,
          topic: "archetype",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "BID_PLACED",
              topic: "archetype",
              data: {
                bidId,
                projectId: archetype,
                slug: "archetype",
                scope: {
                  type: "CNF",
                  cnfId,
                },
                venue: "ARCHIPELAGO",
                bidder,
                nonce: nonce.toString(),
                currency: "ETH",
                price: String(price),
                timestamp: expect.any(String),
                expirationTime: deadline.toISOString(),
              },
            },
          ])
        );

        const bid = {
          bidId,
          slug: "archetype",
          name: "Archetype",
          price,
          bidder,
          nonce: nonce.toString(),
          deadline,
          signature: "0x" + "fe".repeat(65),
          message: "0x",
          agreement: "0x",
          scope: { type: "CNF", scope: cnfId },
        };
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

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          scope: { type: "PROJECT", projectId: archetype },
          price: ethers.BigNumber.from("100"),
          deadline,
          bidder: ethers.constants.AddressZero,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const bid = {
          bidId,
          slug: "archetype",
          name: "Archetype",
          price,
          bidder,
          nonce: nonce.toString(),
          deadline,
          signature: "0x" + "fe".repeat(65),
          message: "0x",
          agreement: "0x",
          scope: { type: "PROJECT", scope: archetype },
        };
        // Bid is included because it's (incorrectly) marked active (for now)
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
        await updateActivityForNonce({
          client,
          account: bidder,
          nonce: nonce.toString(),
          active: false,
        });
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([]);
        expect(
          await ws.getMessages({
            client,
            topic: "archetype",
            since: new Date(0),
          })
        ).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "BID_CANCELLED",
              topic: "archetype",
              data: { bidId, projectId: archetype, slug: "archetype" },
            },
          ])
        );
      })
    );
    it(
      "gets all and active bid IDs for an address",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const deadline = new Date("2050-01-01");
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const priceAffordable = ethers.BigNumber.from("100");
        const priceExpensive = ethers.BigNumber.from("200");
        const bidder = ethers.constants.AddressZero;

        const bidIdAffordable = await addBid({
          client,
          scope: { type: "TOKEN", tokenId },
          price: priceAffordable,
          deadline,
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });

        const bidIdExpensive = await addBid({
          client,
          scope: { type: "TOKEN", tokenId },
          price: priceExpensive,
          deadline,
          bidder: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await client.query(
          `
          UPDATE bids
          SET active_currency_balance = false, active = false
          WHERE bid_id = $1::bidid
          `,
          [bidIdExpensive]
        );

        const bidIdsAffordable = await bidIdsForAddress({
          client,
          address: bidder,
        });
        expect(bidIdsAffordable).toEqual([bidIdAffordable]);

        const bidIdsAll = await bidIdsForAddress({
          client,
          address: bidder,
          includeTemporarilyInactive: true,
        });
        expect(bidIdsAll).toEqual([bidIdAffordable, bidIdExpensive]);
      })
    );
  });

  describe("addAsk", () => {
    it(
      "adds an ask",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const asker = ethers.constants.AddressZero;
        const deadline = new Date("2099-01-01");

        const nonce = ethers.BigNumber.from("0xabcd");
        const askId = await addAsk({
          client,
          tokenId: theCube,
          price,
          deadline,
          asker,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });

        const messages = await ws.getMessages({
          client,
          topic: "archetype",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "ASK_PLACED",
              topic: "archetype",
              data: {
                askId,
                projectId: archetype,
                slug: "archetype",
                tokenIndex: 250,
                venue: "ARCHIPELAGO",
                asker,
                nonce: nonce.toString(),
                currency: "ETH",
                price: String(price),
                timestamp: expect.any(String),
                expirationTime: deadline.toISOString(),
              },
            },
          ])
        );
        const result = [
          {
            askId,
            price,
            createTime: expect.any(Date),
            deadline,
            asker,
            nonce: nonce.toString(),
            signature: "0x" + "fe".repeat(65),
            message: "0x",
            agreement: "0x",
            tokenId: theCube,
          },
        ];
        expect(await floorAsk({ client, tokenId: theCube })).toEqual(askId);
        expect(await askDetails({ client, askIds: [askId] })).toEqual(result);
        expect(await askIdsForToken({ client, tokenId: theCube })).toEqual([
          askId,
        ]);
        expect(await askDetailsForToken({ client, tokenId: theCube })).toEqual(
          result
        );
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
    it(
      "gets all and active ask IDs for an address",
      withTestDb(async ({ client }) => {
        const [archetype, squiggles] = await addProjects(client, [
          snapshots.ARCHETYPE,
          snapshots.SQUIGGLES,
        ]);
        const [theCube, perfectChromatic] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.PERFECT_CHROMATIC,
        ]);
        const price = ethers.BigNumber.from("100");
        const asker = ethers.constants.AddressZero;
        const notAsker = "0x55FaF0e5E6e532b1C5799bDEec1A0F193E54a92D";
        const deadline = new Date("2099-01-01");

        const askIdOwned = await addAsk({
          client,
          tokenId: theCube,
          price,
          deadline,
          asker,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const askIdUnowned = await addAsk({
          client,
          tokenId: perfectChromatic,
          price,
          deadline,
          asker,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await updateActivityForTokenOwners({
          client,
          updates: [
            { tokenId: theCube, newOwner: asker },
            { tokenId: perfectChromatic, newOwner: notAsker },
          ],
        });
        expect(
          await ws.getMessages({
            client,
            topic: "chromie-squiggle",
            since: new Date(0),
          })
        ).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "ASK_CANCELLED",
              topic: "chromie-squiggle",
              data: {
                askId: askIdUnowned,
                projectId: squiggles,
                slug: "chromie-squiggle",
              },
            },
          ])
        );

        expect(await askIdsForAddress({ client, address: asker })).toEqual([
          askIdOwned,
        ]);
        expect(
          await askIdsForAddress({
            client,
            address: asker,
            includeTemporarilyInactive: true,
          })
        ).toEqual([askIdOwned, askIdUnowned]);
      })
    );
  });

  describe("floorAsk(s)", () => {
    it(
      "returns the lowest active ask on a project",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube, arch1] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
        ]);
        const asker = ethers.constants.AddressZero;
        const deadline = new Date("2099-01-01");
        const ask1 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask2 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask3 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await updateActivityForNonce({
          client,
          account: asker,
          nonce: "789",
          active: false,
        });
        const floor = await floorAsk({ client, projectId: archetype });
        expect(floor).toEqual(ask2);
        const floors = await floorAsks({
          client,
          projectId: archetype,
          limit: 2,
        });
        expect(floors).toEqual([ask2, ask1]);
        expect(
          await ws.getMessages({
            client,
            topic: "archetype",
            since: new Date(0),
          })
        ).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "ASK_CANCELLED",
              topic: "archetype",
              data: { askId: ask3, projectId: archetype, slug: "archetype" },
            },
          ])
        );
      })
    );

    it(
      "returns the lowest active ask on a token",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube, arch1] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
        ]);
        const asker = ethers.constants.AddressZero;
        const deadline = new Date("2099-01-01");
        const ask1 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask2 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask3 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await updateActivityForNonce({
          client,
          account: asker,
          nonce: "789",
          active: false,
        });
        const ask4 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("987"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const floor = await floorAsk({ client, tokenId: theCube });
        expect(floor).toEqual(ask2);
        const floors = await floorAsks({
          client,
          tokenId: theCube,
          limit: 2,
        });
        expect(floors).toEqual([ask2, ask1]);
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

  describe("floorAsk", () => {
    it(
      "returns returns the lowest active ask on a project",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube, arch1, arch2] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
        ]);
        const asker = ethers.constants.AddressZero;
        const deadline = new Date("2099-01-01");
        const ask1 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask2 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask3 = await addAsk({
          client,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        await updateActivityForNonce({
          client,
          account: asker,
          nonce: "789",
          active: false,
        });
        const floorAsks = await floorAskIdsForAllTokensInProject({
          client,
          projectId: archetype,
        });
        expect(floorAsks).toEqual([
          { askId: ask1, tokenId: theCube },
          { askId: ask2, tokenId: arch1 },
        ]);
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

  describe("floorAskForEveryProject", () => {
    it(
      "works",
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
        const asker = ethers.constants.AddressZero;
        const deadline = new Date("2099-01-01");
        const ask1 = await addAsk({
          client,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        expect(await floorAskForEveryProject({ client })).toEqual([
          { projectId: archetype, askId: ask1 },
        ]);
        const ask2 = await addAsk({
          client,
          tokenId: aSquiggle,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        const ask3 = await addAsk({
          client,
          tokenId: aSquiggle,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(65),
        });
        expect(await floorAskForEveryProject({ client })).toEqual([
          { projectId: archetype, askId: ask1 },
          { projectId: squiggles, askId: ask3 },
        ]);
        await updateActivityForNonce({
          client,
          account: asker,
          nonce: "789",
          active: false,
        });
        expect(await floorAskForEveryProject({ client })).toEqual([
          { projectId: archetype, askId: ask1 },
          { projectId: squiggles, askId: ask2 },
        ]);
      })
    );
  });
});
