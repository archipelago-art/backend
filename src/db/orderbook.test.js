const ethers = require("ethers");

const sdk = require("@archipelago-art/contracts");

const eth = require("./eth");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const adHocPromise = require("../util/adHocPromise");
const artblocks = require("./artblocks");
const cnfs = require("./cnfs");
const {
  DEFAULT_MARKET,
  addBid,
  addAsk,
  updateActivityForNonce,
  updateActivityForTokenOwners,
  updateActivityForCurrencyBalances,
  deactivateExpiredOrders,
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
  highBidIdsForTokensOwnedBy,
  highFloorBidsForAllProjects,
  bidsSharingScope,
  fillsForAddress,
} = require("./orderbook");
const { testDbProvider } = require("./testUtil");
const { acqrel } = require("./util");
const wellKnownCurrencies = require("./wellKnownCurrencies");
const ws = require("./ws");

const SIG_DIRTY = "0x" + "fe".repeat(64) + "01";
const SIG_CLEAN = "0x" + "fe".repeat(64) + "1c";

function dummyAddress(id) {
  const hash = ethers.utils.id(`addr:${id}`);
  return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12));
}
function dummyTx(id) {
  return ethers.utils.id(`tx:${id}`);
}

// A few blocks from Ethereum mainnet, for testing.
function realBlocks() {
  const result = [];
  function pushBlock(hash, timestamp) {
    const parentHash =
      result[result.length - 1]?.hash ?? ethers.constants.HashZero;
    const number = result.length;
    const block = { hash, parentHash, number, timestamp };
    result.push(block);
  }
  pushBlock(
    "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
    0
  );
  pushBlock(
    "0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6",
    1438269988
  );
  pushBlock(
    "0xb495a1d7e6663152ae92708da4843337b958146015a2802f4193a410044698c9",
    1438270017
  );
  return result;
}

describe("db/orderbook", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProjects(client, projectIds) {
    const results = await sc.addProjects(client, projectIds);
    return results.map((x) => x.projectId);
  }

  async function addTokens(client, artblocksTokenIds) {
    const results = await sc.addTokens(client, artblocksTokenIds);
    return results.map((x) => x.tokenId);
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
      "requires a valid signature and order agreement hash",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const bidder = ethers.constants.AddressZero;

        function swizzleBytes(bytes) {
          const b0 = ethers.BigNumber.from(255).sub(
            ethers.utils.hexDataSlice(bytes, 0, 1)
          );
          return ethers.utils.hexConcat([
            b0,
            ethers.utils.hexDataSlice(bytes, 1),
          ]);
        }

        const agreementStruct = {
          currencyAddress: wellKnownCurrencies.weth9.address,
          price: "1000",
          tokenAddress: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
          requiredRoyalties: [ethers.constants.HashZero], // TODO
        };
        const agreementHash = sdk.market.hash.orderAgreement(agreementStruct);
        const bidStruct = {
          agreementHash,
          nonce: "0xabcd",
          deadline: Math.floor(+deadline / 1000),
          extraRoyalties: [],
          trait: ethers.utils.defaultAbiCoder.encode(
            ["uint256"],
            [snapshots.THE_CUBE.onChainTokenId]
          ),
          traitOracle: ethers.constants.AddressZero,
        };
        const signer = new ethers.Wallet(ethers.constants.MaxUint256);
        const domainInfo = { chainId: 7, marketAddress: DEFAULT_MARKET };
        const goodSignature = await sdk.market.sign712.bid(
          signer,
          domainInfo,
          bidStruct
        );
        const badSigner = new ethers.Wallet(ethers.constants.MaxUint256.sub(1));
        const badSignature = await sdk.market.sign712.bid(
          badSigner,
          domainInfo,
          bidStruct
        );

        const bidStructBadAgreement = {
          ...bidStruct,
          agreementHash: swizzleBytes(agreementHash),
        };
        const goodSignatureBadAgreement = await sdk.market.sign712.bid(
          signer,
          domainInfo,
          bidStructBadAgreement
        );

        async function go(bidStruct, signature) {
          try {
            return await addBid({
              client,
              noVerify: false,
              chainId: 7,
              marketAddress: DEFAULT_MARKET,
              scope: { type: "TOKEN", tokenId },
              price: agreementStruct.price,
              deadline,
              bidder: signer.address,
              nonce: ethers.BigNumber.from(bidStruct.nonce),
              agreement: ethers.utils.defaultAbiCoder.encode(
                [sdk.market.abi.OrderAgreement],
                [agreementStruct]
              ),
              message: ethers.utils.defaultAbiCoder.encode(
                [sdk.market.abi.Bid],
                [bidStruct]
              ),
              signature,
            });
          } finally {
            await client.query("ROLLBACK");
          }
        }

        await expect(go(bidStruct, badSignature)).rejects.toThrow(
          /bid signer: want 0x.*, got 0x.*/
        );
        await expect(
          go(bidStructBadAgreement, goodSignatureBadAgreement)
        ).rejects.toThrow(/bid agreement hash: want 0x.*, got 0x.*/);
        await expect(go(bidStruct, goodSignature)).resolves.toEqual(
          expect.any(String)
        );
      })
    );

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
          noVerify: true,
          scope: { type: "PROJECT", projectId: archetype },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
                deadline: deadline.toISOString(),
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
          createTime: expect.any(Date),
          deadline,
          signature: SIG_CLEAN,
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
          noVerify: true,
          scope: { type: "TOKEN", tokenId },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
                deadline: deadline.toISOString(),
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
          createTime: expect.any(Date),
          deadline,
          signature: SIG_CLEAN,
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
          noVerify: true,
          scope: { type: "TRAIT", traitId },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
                deadline: deadline.toISOString(),
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
          createTime: expect.any(Date),
          deadline,
          signature: SIG_CLEAN,
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
          noVerify: true,
          scope: { type: "CNF", cnfId },
          price: ethers.BigNumber.from("100"),
          deadline: new Date("2099-01-01"),
          bidder: ethers.constants.AddressZero,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
                deadline: deadline.toISOString(),
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
          createTime: expect.any(Date),
          deadline,
          signature: SIG_CLEAN,
          message: "0x",
          agreement: "0x",
          scope: { type: "CNF", scope: cnfId },
        };
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
      })
    );

    it(
      "can deactivate bids after they expire",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const initialDeadline = new Date("2099-01-01");
        const expiredDeadline = new Date("1999-01-01");
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const bidder = ethers.constants.AddressZero;

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          noVerify: true,
          scope: { type: "PROJECT", projectId: archetype },
          price: ethers.BigNumber.from("100"),
          deadline: initialDeadline,
          bidder: ethers.constants.AddressZero,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const bid = {
          bidId,
          slug: "archetype",
          name: "Archetype",
          price,
          bidder,
          nonce: nonce.toString(),
          createTime: expect.any(Date),
          deadline: initialDeadline,
          signature: SIG_CLEAN,
          message: "0x",
          agreement: "0x",
          scope: { type: "PROJECT", scope: archetype },
        };
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([bid]);
        await client.query(
          "UPDATE bids SET deadline = $2::timestamptz WHERE bid_id = $1::bidid",
          [bidId, expiredDeadline]
        );
        // Bid isn't officially deactivated yet, but is still omitted from
        // output because its deadline is in the past.
        expect(await isBidActive(client, bidId)).toEqual(true); // not deactivated yet
        expect(await bidDetailsForToken({ client, tokenId })).toEqual([]);
        const expirations = await deactivateExpiredOrders({ client });
        expect(expirations).toEqual({ bids: 1, asks: 0 });
        expect(await isBidActive(client, bidId)).toEqual(false);

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
              data: {
                bidId,
                projectId: archetype,
                slug: "archetype",
                venue: "ARCHIPELAGO",
              },
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
          noVerify: true,
          scope: { type: "TOKEN", tokenId },
          price: priceAffordable,
          deadline,
          bidder,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: SIG_CLEAN,
        });

        const bidIdExpensive = await addBid({
          client,
          noVerify: true,
          scope: { type: "TOKEN", tokenId },
          price: priceExpensive,
          deadline,
          bidder,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: SIG_CLEAN,
        });
        await updateActivityForCurrencyBalances({
          client,
          updates: [{ account: bidder, newBalance: priceExpensive.sub(1) }],
        });
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
              data: {
                bidId: bidIdExpensive,
                projectId: archetype,
                slug: "archetype",
                venue: "ARCHIPELAGO",
              },
            },
          ])
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
      "requires a valid signature and order agreement hash",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const asker = ethers.constants.AddressZero;

        function swizzleBytes(bytes) {
          const b0 = ethers.BigNumber.from(255).sub(
            ethers.utils.hexDataSlice(bytes, 0, 1)
          );
          return ethers.utils.hexConcat([
            b0,
            ethers.utils.hexDataSlice(bytes, 1),
          ]);
        }

        const agreementStruct = {
          currencyAddress: wellKnownCurrencies.weth9.address,
          price,
          tokenAddress: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
          requiredRoyalties: [ethers.constants.HashZero], // TODO
        };
        const agreementHash = sdk.market.hash.orderAgreement(agreementStruct);
        const askStruct = {
          agreementHash,
          nonce: "0xabcd",
          deadline: Math.floor(+deadline / 1000),
          extraRoyalties: [],
          tokenId: snapshots.THE_CUBE.onChainTokenId,
          unwrapWeth: false,
          authorizedBidder: ethers.constants.AddressZero,
        };
        const signer = new ethers.Wallet(ethers.constants.MaxUint256);
        const domainInfo = { chainId: 7, marketAddress: DEFAULT_MARKET };
        const goodSignature = await sdk.market.sign712.ask(
          signer,
          domainInfo,
          askStruct
        );
        const badSigner = new ethers.Wallet(ethers.constants.MaxUint256.sub(1));
        const badSignature = await sdk.market.sign712.ask(
          badSigner,
          domainInfo,
          askStruct
        );

        const askStructBadAgreement = {
          ...askStruct,
          agreementHash: swizzleBytes(agreementHash),
        };
        const goodSignatureBadAgreement = await sdk.market.sign712.ask(
          signer,
          domainInfo,
          askStructBadAgreement
        );

        const askStructBadTokenId = {
          ...askStruct,
          tokenId: 12345,
        };
        const goodSignatureBadTokenId = await sdk.market.sign712.ask(
          signer,
          domainInfo,
          askStructBadTokenId
        );

        async function go(askStruct, signature) {
          try {
            return await addAsk({
              client,
              noVerify: false,
              chainId: 7,
              tokenId,
              price,
              deadline,
              asker: signer.address,
              nonce: ethers.BigNumber.from(askStruct.nonce),
              agreement: ethers.utils.defaultAbiCoder.encode(
                [sdk.market.abi.OrderAgreement],
                [agreementStruct]
              ),
              message: ethers.utils.defaultAbiCoder.encode(
                [sdk.market.abi.Ask],
                [askStruct]
              ),
              signature,
            });
          } finally {
            await client.query("ROLLBACK");
          }
        }

        await expect(go(askStruct, badSignature)).rejects.toThrow(
          /ask signer: want 0x.*, got 0x.*/
        );
        await expect(
          go(askStructBadAgreement, goodSignatureBadAgreement)
        ).rejects.toThrow(/ask agreement hash: want 0x.*, got 0x.*/);
        await expect(
          go(askStructBadTokenId, goodSignatureBadTokenId)
        ).rejects.toThrow(/ask tokenId: want 23000250, got 12345/);
        await expect(go(askStruct, goodSignature)).resolves.toEqual(
          expect.any(String)
        );
      })
    );

    it(
      "adds an ask",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const price = ethers.BigNumber.from("100");
        const asker = ethers.constants.AddressZero;
        const deadline = new Date("2099-01-01");
        const slug = "archetype";
        const name = "Archetype";

        const nonce = ethers.BigNumber.from("0xabcd");
        const askId = await addAsk({
          client,
          noVerify: true,
          tokenId: theCube,
          price,
          deadline,
          asker,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
                slug: slug,
                tokenIndex: 250,
                venue: "ARCHIPELAGO",
                asker,
                nonce: nonce.toString(),
                currency: "ETH",
                price: String(price),
                timestamp: expect.any(String),
                deadline: deadline.toISOString(),
              },
            },
          ])
        );
        const result = [
          {
            askId,
            slug,
            name,
            price,
            createTime: expect.any(Date),
            deadline,
            asker,
            nonce: nonce.toString(),
            signature: SIG_CLEAN,
            message: "0x",
            agreement: "0x",
            tokenId: theCube,
            tokenIndex: 250,
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
      "marks new asks as inactive if they have already expired",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [theCube] = await addTokens(client, [snapshots.THE_CUBE]);
        const deadline = new Date("2000-01-01"); // expired!
        const askId = await addAsk({
          client,
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker: ethers.constants.AddressZero,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: SIG_CLEAN,
        });
        const active = await isAskActive(client, askId);
        expect(active).toBe(false); // for now...
        expect(
          await ws.getMessages({
            client,
            topic: "archetype",
            since: new Date(0),
          })
        ).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "ASK_PLACED" }),
          ])
        );
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
          noVerify: true,
          tokenId: theCube,
          price,
          deadline,
          asker,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const askIdUnowned = await addAsk({
          client,
          noVerify: true,
          tokenId: perfectChromatic,
          price,
          deadline,
          asker,
          nonce: ethers.BigNumber.from("0xabcd"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
                tokenIndex: 7583,
                venue: "ARCHIPELAGO",
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
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask2 = await addAsk({
          client,
          noVerify: true,
          tokenId: arch1,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask3 = await addAsk({
          client,
          noVerify: true,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });
        // Cancel the nonce for the lowest ask, which should mark the ask as
        // cancelled.
        await eth.addNonceCancellations({
          client,
          marketContract: DEFAULT_MARKET,
          cancellations: [
            {
              account: asker,
              nonce: "789",
              blockHash: blocks[1].hash,
              logIndex: 2,
              transactionHash: dummyTx(1),
            },
          ],
        });
        // Another ask with the cancelled nonce *added later* should still be marked as inactive.
        const ask4 = await addAsk({
          client,
          noVerify: true,
          tokenId: arch1,
          price: ethers.BigNumber.from("4"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
              data: {
                askId: ask3,
                projectId: archetype,
                slug: "archetype",
                tokenIndex: 36,
                venue: "ARCHIPELAGO",
              },
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
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask2 = await addAsk({
          client,
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask3 = await addAsk({
          client,
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        await updateActivityForNonce({
          client,
          account: asker,
          nonce: "789",
          active: false,
        });
        const ask4 = await addAsk({
          client,
          noVerify: true,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("987"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask2 = await addAsk({
          client,
          noVerify: true,
          tokenId: arch1,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask3 = await addAsk({
          client,
          noVerify: true,
          tokenId: arch1,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
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
            noVerify: true,
            scope,
            price,
            deadline: new Date("2099-01-01"),
            bidder: ethers.constants.AddressZero,
            nonce: ethers.BigNumber.from("0xabcd").add(price),
            agreement: "0x",
            message: "0x",
            signature: SIG_DIRTY,
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

  describe("highBidIdsForTokensOwnedBy", () => {
    it(
      "includes the highest bid excluding bids by the owner",
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

        // Cases to consider:
        // - token with two bids (take higher)
        // - token with two bids but the highest is the owner's
        // - token with only bid by the owner
        // - token with only inactive bids
        // - token owned by someone else

        async function makeBid({ scope, price, bidder, nonce = null }) {
          if (nonce == null) nonce = ethers.BigNumber.from("0xabcd");
          return await addBid({
            client,
            noVerify: true,
            scope,
            price,
            deadline: new Date("2099-01-01"),
            bidder,
            nonce,
            agreement: "0x",
            message: "0x",
            signature: SIG_DIRTY,
          });
        }

        // Query on behalf of Camille; Alice and Bob are bidders.
        const alice = dummyAddress("alice");
        const bob = dummyAddress("bob");
        const camille = dummyAddress("camille");

        // `theCube`: two valid bids, one higher than the other.
        const bidCube = await makeBid({
          scope: { type: "TOKEN", tokenId: theCube },
          price: "100",
          bidder: alice,
        });
        await makeBid({
          scope: { type: "TOKEN", tokenId: theCube },
          price: "95",
          bidder: bob,
        });

        // `tri1`: highest bid is by owner; second-highest should be chosen.
        const bidTri1 = await makeBid({
          scope: { type: "TOKEN", tokenId: tri1 },
          price: "100",
          bidder: alice,
        });
        await makeBid({
          scope: { type: "TOKEN", tokenId: tri1 },
          price: "999",
          bidder: camille,
        });

        // `tri2`: only bid is by the owner; no result.
        await makeBid({
          scope: { type: "TOKEN", tokenId: tri2 },
          price: "999",
          bidder: camille,
        });

        // `a66`: only bid is cancelled.
        await makeBid({
          scope: { type: "TOKEN", tokenId: a66 },
          nonce: 0xdead,
          price: "456",
          bidder: alice,
        });
        await updateActivityForNonce({
          client,
          account: alice,
          nonce: 0xdead,
          active: false,
        });

        // `aSquiggle`: valid high bid, but not Camille's token.
        await makeBid({
          scope: { type: "TOKEN", tokenId: aSquiggle },
          price: "789",
          bidder: bob,
        });

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

        function transfer({ tokenId, to, blockNumber, i } = {}) {
          return {
            tokenId,
            fromAddress: ethers.constants.AddressZero,
            toAddress: to,
            blockNumber: 0,
            blockHash: blocks[0].hash,
            logIndex: i,
            transactionHash: dummyTx(i),
          };
        }

        const transfers = [
          transfer({ i: 0, to: camille, tokenId: theCube }),
          transfer({ i: 1, to: camille, tokenId: tri1 }),
          transfer({ i: 2, to: camille, tokenId: tri2 }),
          transfer({ i: 3, to: camille, tokenId: a66 }),
          transfer({ i: 4, to: alice, tokenId: aSquiggle }),
        ];
        await eth.addErc721Transfers({ client, transfers });

        const res = await highBidIdsForTokensOwnedBy({
          client,
          account: camille,
        });
        expect(res).toEqual([
          { tokenId: theCube, bidId: bidCube },
          { tokenId: tri1, bidId: bidTri1 },
        ]);
      })
    );
  });

  describe("highFloorBidsForAllProjects", () => {
    it(
      "returns the highest floor bid per project",
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
            noVerify: true,
            scope,
            price,
            deadline: new Date("2099-01-01"),
            bidder: ethers.constants.AddressZero,
            nonce: ethers.BigNumber.from("0xabcd").add(price),
            agreement: "0x",
            message: "0x",
            signature: SIG_DIRTY,
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

        const res1 = await highFloorBidsForAllProjects({
          client,
        });
        expect(res1).toEqual({
          "chromie-squiggle": {
            bidId: bidFloorSquiggles,
            bidder: ethers.constants.AddressZero,
            price: "100",
            projectId: squiggles,
          },
        });

        // Now, add an Archetype floor bid.
        const bidFloorArchetype = await makeBid({
          scope: { type: "PROJECT", projectId: archetype },
          price: "200",
        });

        const res2 = await highFloorBidsForAllProjects({
          client,
        });
        expect(res2).toEqual({
          archetype: {
            bidId: bidFloorArchetype,
            bidder: ethers.constants.AddressZero,
            price: "200",
            projectId: archetype,
          },
          "chromie-squiggle": {
            bidId: bidFloorSquiggles,
            bidder: ethers.constants.AddressZero,
            price: "100",
            projectId: squiggles,
          },
        });

        // Now, new floor bids.
        const bidFloorSquigglesHigher = await makeBid({
          scope: { type: "PROJECT", projectId: squiggles },
          price: "150",
        });
        const bidFloorSquigglesLower = await makeBid({
          scope: { type: "PROJECT", projectId: squiggles },
          price: "90",
        });

        const res3 = await highFloorBidsForAllProjects({
          client,
        });
        expect(res3).toEqual({
          archetype: {
            bidId: bidFloorArchetype,
            bidder: ethers.constants.AddressZero,
            price: "200",
            projectId: archetype,
          },
          "chromie-squiggle": {
            bidId: bidFloorSquigglesHigher,
            bidder: ethers.constants.AddressZero,
            price: "150",
            projectId: squiggles,
          },
        });
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
          noVerify: true,
          tokenId: theCube,
          price: ethers.BigNumber.from("100"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("123"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        expect(await floorAskForEveryProject({ client })).toEqual([
          {
            projectId: archetype,
            askId: ask1,
            asker: asker,
            price: ethers.BigNumber.from("100"),
          },
        ]);
        const ask2 = await addAsk({
          client,
          noVerify: true,
          tokenId: aSquiggle,
          price: ethers.BigNumber.from("50"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("456"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        const ask3 = await addAsk({
          client,
          noVerify: true,
          tokenId: aSquiggle,
          price: ethers.BigNumber.from("5"),
          deadline,
          asker,
          nonce: ethers.BigNumber.from("789"),
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        expect(await floorAskForEveryProject({ client })).toEqual([
          {
            projectId: archetype,
            askId: ask1,
            asker: asker,
            price: ethers.BigNumber.from("100"),
          },
          {
            projectId: squiggles,
            askId: ask3,
            asker: asker,
            price: ethers.BigNumber.from("5"),
          },
        ]);
        await updateActivityForNonce({
          client,
          account: asker,
          nonce: "789",
          active: false,
        });
        expect(await floorAskForEveryProject({ client })).toEqual([
          {
            projectId: archetype,
            askId: ask1,
            asker: asker,
            price: ethers.BigNumber.from("100"),
          },
          {
            projectId: squiggles,
            askId: ask2,
            asker: asker,
            price: ethers.BigNumber.from("50"),
          },
        ]);
      })
    );
  });
  describe("bidsSharingScope", () => {
    it(
      "returns shared bids with with token scope",
      withTestDb(async ({ client }) => {
        const [archetype] = await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId, tokenId2] = await addTokens(client, [
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
        ]);
        const price = ethers.BigNumber.from("100");
        const deadline = new Date("2099-01-01");
        const bidder = ethers.constants.AddressZero;

        const nonce = ethers.BigNumber.from("0xabcd");
        const bidId = await addBid({
          client,
          noVerify: true,
          scope: { type: "TOKEN", tokenId },
          price,
          deadline,
          bidder,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });

        expect(await bidsSharingScope({ client, scope: tokenId })).toEqual([
          {
            bidId,
            price: String(price),
            bidder,
            deadline: deadline.toISOString(),
            createTime: expect.any(String),
          },
        ]);

        const bidder2 = dummyAddress("bidder2");
        const bidId2 = await addBid({
          client,
          noVerify: true,
          scope: { type: "TOKEN", tokenId },
          price: ethers.BigNumber.from("150"),
          deadline,
          bidder: bidder2,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        await addBid({
          client,
          noVerify: true,
          scope: { type: "TOKEN", tokenId: tokenId2 },
          price: ethers.BigNumber.from("120"),
          deadline,
          bidder: bidder2,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        expect(await bidsSharingScope({ client, scope: tokenId })).toEqual(
          expect.arrayContaining([
            {
              bidId: bidId2,
              price: "150",
              bidder: bidder2,
              deadline: deadline.toISOString(),
              createTime: expect.any(String),
            },
            {
              bidId,
              price: String(price),
              bidder,
              deadline: deadline.toISOString(),
              createTime: expect.any(String),
            },
          ])
        );
        expect(
          await bidsSharingScope({ client, scope: tokenId, address: bidder })
        ).toEqual([
          {
            bidId,
            price: String(price),
            bidder: ethers.utils.getAddress(bidder),
            deadline: deadline.toISOString(),
            createTime: expect.any(String),
          },
        ]);
      })
    );
  });
  describe("fillsForAddress", () => {
    it(
      "returns fills",
      withTestDb(async ({ client }) => {
        await addProjects(client, [snapshots.ARCHETYPE]);
        await addTokens(client, [snapshots.THE_CUBE]);

        const alice = dummyAddress("alice");
        const bob = dummyAddress("bob");
        const charlie = dummyAddress("charlie");
        const market = dummyAddress("market");

        const [tradeId1, tradeId2] = [
          ethers.utils.id("tradeid:1"),
          ethers.utils.id("tradeid:2"),
        ].sort();

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

        const aliceSellsCube = {
          tradeId: tradeId1,
          tokenContract: snapshots.THE_CUBE.tokenContract,
          onChainTokenId: snapshots.THE_CUBE.onChainTokenId,
          buyer: bob,
          seller: alice,
          currency: wellKnownCurrencies.weth9.address,
          price: "1000",
          proceeds: "995",
          cost: "1005",
          blockHash: blocks[1].hash,
          logIndex: 1,
          transactionHash: dummyTx(1),
        };
        const bobSellsCube = {
          tradeId: tradeId2,
          tokenContract: snapshots.THE_CUBE.tokenContract,
          onChainTokenId: snapshots.THE_CUBE.onChainTokenId,
          buyer: charlie,
          seller: bob,
          currency: wellKnownCurrencies.weth9.address,
          price: "1000",
          proceeds: "995",
          cost: "1005",
          blockHash: blocks[1].hash,
          logIndex: 2,
          transactionHash: dummyTx(2),
        };
        const fills = [aliceSellsCube, bobSellsCube];
        await eth.addFills({ client, marketContract: market, fills });
        const result = await fillsForAddress({ client, address: alice });
        expect(result).toEqual([
          {
            tradeId: expect.any(String),
            projectId: expect.any(String),
            name: "Archetype",
            slug: "archetype",
            imageTemplate: "{baseUrl}/artblocks/{sz}/23/{hi}/{lo}",
            tokenIndex: 250,
            tokenId: expect.any(String),
            buyer: bob,
            seller: alice,
            price: "1000",
            blockNumber: 1,
            tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
            onChainTokenId: String(snapshots.THE_CUBE.onChainTokenId),
          },
        ]);
      })
    );
  });
});
