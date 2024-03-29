const ethers = require("ethers");

const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const autoglyphs = require("../db/autoglyphs");
const tokens = require("../db/tokens");
const emails = require("../db/emails");
const eth = require("../db/eth");
const openseaIngest = require("../db/opensea/ingestEvents");
const orderbook = require("../db/orderbook");
const wellKnownCurrencies = require("../db/wellKnownCurrencies");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const { addAutoglyphs } = require("../db/autoglyphs");
const { addCryptoadz } = require("../db/cryptoadz");
const Cmp = require("../util/cmp");

describe("api", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function setup(client) {
    const { projectId: archetypeId } = await sc.addProject(
      client,
      snapshots.ARCHETYPE
    );
    const { projectId: squigglesId } = await sc.addProject(
      client,
      snapshots.SQUIGGLES
    );
    const { tokenId: theCube } = await sc.addToken(client, snapshots.THE_CUBE);
    const { tokenId: perfectChromatic } = await sc.addToken(
      client,
      snapshots.PERFECT_CHROMATIC
    );
    return { archetypeId, squigglesId, theCube, perfectChromatic };
  }

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const { archetypeId, squigglesId, theCube } = await setup(client);
      const res = await api.collections({ client });
      expect(res).toEqual([
        {
          projectId: squigglesId,
          slug: "chromie-squiggle",
          artblocksProjectIndex: 0,
          imageUrlTemplate: expect.stringContaining("/0/"),
          name: "Chromie Squiggle",
          artistName: "Snowfro",
          description: expect.stringContaining(
            "the soul of the Art Blocks platform"
          ),
          aspectRatio: 1.5,
          numTokens: 1,
          maxInvocations: 10000,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
          fees: [
            {
              micros: 5000,
              static: true,
              target: "0x1fC12C9f68A6B0633Ba5897A40A8e61ed9274dC9",
              includeInOrders: false,
            },
            {
              micros: 5000,
              static: true,
              target: "0xA76456bb6aBC50FB38e17c042026bc27a95C3314",
            },
            {
              micros: 75000,
              static: false,
              target: "0x8A3F65eF24021D401815792c4B65676FBF90663c",
            },
          ],
        },
        {
          projectId: archetypeId,
          slug: "archetype",
          artblocksProjectIndex: 23,
          imageUrlTemplate: expect.stringContaining("/23/"),
          name: "Archetype",
          artistName: "Kjetil Golid",
          description: expect.stringContaining("repetition as a counterweight"),
          aspectRatio: 1,
          numTokens: 1,
          maxInvocations: 600,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
          fees: [
            {
              micros: 5000,
              static: true,
              target: "0x1fC12C9f68A6B0633Ba5897A40A8e61ed9274dC9",
              includeInOrders: false,
            },
            {
              micros: 5000,
              static: true,
              target: "0xA76456bb6aBC50FB38e17c042026bc27a95C3314",
            },
            {
              micros: 75000,
              static: false,
              target: "0x8A3F65eF24021D401815792c4B65676FBF90663c",
            },
          ],
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
      const { archetypeId, squigglesId, theCube } = await setup(client);
      const res = await api.collection({ client, slug: "archetype" });
      expect(res).toEqual({
        projectId: archetypeId,
        slug: "archetype",
        artblocksProjectIndex: 23,
        imageUrlTemplate: expect.stringContaining("/23/"),
        name: "Archetype",
        artistName: "Kjetil Golid",
        description: expect.stringContaining("repetition as a counterweight"),
        aspectRatio: 1,
        numTokens: 1,
        maxInvocations: 600,
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        fees: expect.arrayContaining([
          expect.objectContaining({
            target: "0x1fC12C9f68A6B0633Ba5897A40A8e61ed9274dC9",
          }),
        ]),
      });
    })
  );

  it(
    "resolves a token ID",
    withTestDb(async ({ client }) => {
      const { theCube } = await setup(client);
      const res = await api.tokenIdBySlugAndIndex({
        client,
        slug: "archetype",
        tokenIndex: 250,
      });
      expect(res).toEqual(theCube);
    })
  );

  it(
    "provides project tokens",
    withTestDb(async ({ client }) => {
      const { projectId: archetypeId } = await sc.addProject(
        client,
        snapshots.ARCHETYPE
      );
      const [a1, a2, a3] = [
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
      ];
      const ids = new Map();
      // Add them out of order; make sure that the output is still sorted by
      // token index.
      const tokens = await sc.addTokens(client, [a3, a2, a1]);
      const res = await api.collectionTokens({ client, slug: "archetype" });
      expect(res).toEqual(
        tokens
          .slice()
          .reverse()
          .map((t) => ({
            tokenId: t.tokenId,
            tokenIndex: t.spec.onChainTokenId % 1e6,
            onChainTokenId: String(t.spec.onChainTokenId),
          }))
      );
    })
  );

  it(
    "resolves specific feature/trait IDs and gets trait data back",
    withTestDb(async ({ client }) => {
      await sc.addProjects(client, snapshots.PROJECTS);
      const ids = new Map();
      for (const onChainId of snapshots.TOKENS) {
        const { tokenId } = await sc.addToken(client, onChainId);
        ids.set(onChainId, tokenId);
      }
      const archetype = await api.resolveProjectId({
        client,
        slug: "archetype",
      });
      const res = await api.resolveTraitIds({
        client,
        projectId: archetype,
        keys: [
          { featureName: "Coloring strategy", traitValue: "Single" },
          { featureName: "Coloring strategy", traitValue: "Random" },
          // not requesting "Coloring strategy: Group"
          { featureName: "Coloring strategy", traitValue: "No such trait" },
          { featureName: "Palette", traitValue: "Paddle" },
          { featureName: "Palette", traitValue: "Nightlife" },
          { featureName: "No such feature", traitValue: "Wat" },
        ],
      });
      expect(res).toHaveLength(4);
      const traitDataComparator = Cmp.first([
        Cmp.comparing((r) => r.featureName),
        Cmp.comparing((r) => r.traitValue),
      ]);
      const anyIds = {
        featureId: expect.any(String),
        traitId: expect.any(String),
      };
      expect(res.sort(traitDataComparator)).toEqual([
        { ...anyIds, featureName: "Coloring strategy", traitValue: "Random" },
        { ...anyIds, featureName: "Coloring strategy", traitValue: "Single" },
        { ...anyIds, featureName: "Palette", traitValue: "Nightlife" },
        { ...anyIds, featureName: "Palette", traitValue: "Paddle" },
      ]);

      const traitIdSingle = res[1].traitId;
      const traitIdPaddle = res[3].traitId;
      const res2 = await api.getTraitData({
        client,
        traitIds: [traitIdSingle, traitIdPaddle],
      });
      expect(res2.sort(traitDataComparator)).toEqual([
        {
          ...anyIds,
          featureName: "Coloring strategy",
          traitValue: "Single",
          projectId: archetype,
        },
        {
          ...anyIds,
          featureName: "Palette",
          traitValue: "Paddle",
          projectId: archetype,
        },
      ]);
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
      await sc.addProjects(client, snapshots.PROJECTS);
      await sc.addTokens(client, snapshots.TOKENS);
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
                tokenIndices: [snapshots.THE_CUBE.onChainTokenId % 1e6],
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
      const { project } = await sc.addProject(client, snapshots.ARCHETYPE);
      const collection = api.artblocksProjectIdToCollectionName(
        project.projectId
      );
      const { tokenId } = await sc.addToken(client, snapshots.THE_CUBE);
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
    "provides chain data for a single token",
    withTestDb(async ({ client }) => {
      const { theCube } = await setup(client);

      const res = await api.tokenChainData({ client, tokenId: theCube });
      expect(res).toEqual({
        tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        onChainTokenId: String(snapshots.THE_CUBE.onChainTokenId),
      });
    })
  );

  it(
    "provides summaries for multiple tokens",
    withTestDb(async ({ client }) => {
      await setup(client);
      await autoglyphs.addAutoglyphs({ client });
      const result = await api.tokenSummariesByOnChainId({
        client,
        tokens: [
          {
            address: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
            tokenId: String(snapshots.PERFECT_CHROMATIC.onChainTokenId),
          },
          {
            address: autoglyphs.CONTRACT_ADDRESS,
            tokenId: "293",
          },
        ],
      });
      expect(result).toEqual([
        {
          name: "Chromie Squiggle",
          slug: "chromie-squiggle",
          imageUrlTemplate:
            "https://img.archipelago.art/artblocks/{sz}/0/007/583",
          tokenIndex: 7583,
          artistName: "Snowfro",
          aspectRatio: 1.5,
          onChainTokenId: "7583",
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
        },
        {
          name: "Autoglyphs",
          slug: "autoglyphs",
          imageUrlTemplate: "https://img.archipelago.art/autoglyphs/svg/293",
          tokenIndex: 293,
          artistName: "Larva Labs",
          aspectRatio: 1,
          onChainTokenId: "293",
          tokenContract: autoglyphs.CONTRACT_ADDRESS,
        },
      ]);
    })
  );

  it(
    "provides tokens for an account",
    withTestDb(async ({ client }) => {
      function dummyBlockHash(blockNumber) {
        return ethers.utils.id(`block:${blockNumber}`);
      }
      function dummyTx(id) {
        return ethers.utils.id(`tx:${id}`);
      }
      function dummyAddress(id) {
        const hash = ethers.utils.id(`addr:${id}`);
        return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12));
      }

      const { archetypeId, squigglesId, theCube } = await setup(client);

      await eth.addBlocks({
        client,
        blocks: [
          {
            hash: dummyBlockHash(0),
            parentHash: ethers.constants.HashZero,
            number: 0,
            timestamp: ethers.BigNumber.from(Date.parse("2020-12-30") / 1000),
          },
          {
            hash: dummyBlockHash(1),
            parentHash: dummyBlockHash(0),
            number: 1,
            timestamp: ethers.BigNumber.from(Date.parse("2021-01-02") / 1000),
          },
          {
            hash: dummyBlockHash(2),
            parentHash: dummyBlockHash(1),
            number: 2,
            timestamp: ethers.BigNumber.from(Date.parse("2021-02-08") / 1000),
          },
        ],
      });

      let nextLogIndex = 101;
      function transfer({ to, from, blockNumber, tx } = {}) {
        return {
          tokenId: theCube,
          fromAddress: from,
          toAddress: to,
          blockHash: dummyBlockHash(blockNumber),
          logIndex: nextLogIndex++,
          transactionHash: tx,
        };
      }

      const zero = ethers.constants.AddressZero;
      const alice = dummyAddress("alice.eth");
      const bob = dummyAddress("bob.eth");
      const cheryl = dummyAddress("cheryl.eth");
      const cherylsVault = dummyAddress("vault.cheryl.eth");

      const transfers = [
        transfer({ from: zero, to: alice, blockNumber: 0, tx: dummyTx(1) }),
        transfer({ from: alice, to: bob, blockNumber: 1, tx: dummyTx(2) }),
        transfer({ from: bob, to: cheryl, blockNumber: 2, tx: dummyTx(3) }),
        transfer({
          from: cheryl,
          to: cherylsVault,
          blockNumber: 2,
          tx: dummyTx(3), // same tx as previous: manual transfer away
        }),
      ];
      await eth.addErc721Transfers({ client, transfers });

      const price = 1000;
      const deadline = new Date("2099-01-01");
      const bidder = alice;
      const bidId = await orderbook.addBid({
        client,
        noVerify: true,
        scope: { type: "PROJECT", projectId: archetypeId },
        price,
        deadline,
        bidder,
        nonce: ethers.BigNumber.from("0xabcd"),
        agreement: "0x",
        message: "0x",
        signature: "0x" + "fe".repeat(64) + "1c",
      });
      await orderbook.addBid({
        client,
        noVerify: true,
        scope: { type: "PROJECT", projectId: archetypeId },
        price: price * 2,
        deadline,
        bidder,
        nonce: ethers.BigNumber.from("0xdcba"),
        agreement: "0x",
        message: "0x",
        signature: "0x" + "fe".repeat(64) + "1c",
      });
      await orderbook.updateActivityForNonce({
        client,
        account: bidder,
        nonce: ethers.BigNumber.from("0xdcba"),
        active: false,
      });

      const tokens = await api.tokenSummariesByAccount({
        client,
        account: cherylsVault,
      });
      expect(tokens.length).toEqual(1);
      expect(tokens[0]).toEqual({
        name: "Archetype",
        slug: "archetype",
        imageUrlTemplate:
          "https://img.archipelago.art/artblocks/{sz}/23/000/250",
        tokenIndex: 250,
        tokenId: theCube,
        artistName: "Kjetil Golid",
        aspectRatio: 1,
        tokenContract: "0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270",
        onChainTokenId: "23000250",
        bid: {
          bidId,
          price: String(price),
          deadline,
          bidder,
          scope: { type: "PROJECT", scope: archetypeId },
        },
      });
    })
  );

  it(
    "provides a unified history of sales and transfers",
    withTestDb(async ({ client }) => {
      await sc.addProject(client, snapshots.ARCHETYPE);
      const { rawTokenData: theCube, tokenId } = await sc.addToken(
        client,
        snapshots.THE_CUBE
      );

      function dummyBlockHash(blockNumber) {
        return ethers.utils.id(`block:${blockNumber}`);
      }
      function dummyTx(id) {
        return ethers.utils.id(`tx:${id}`);
      }
      function dummyAddress(id) {
        const hash = ethers.utils.id(`addr:${id}`);
        return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12));
      }

      let nextOpenseaSaleId = 1;
      function openseaSale({
        id = String(nextOpenseaSaleId++),
        address = snapshots.THE_CUBE.tokenContract,
        tokenId = snapshots.THE_CUBE.onChainTokenId,
        listingTime,
        to,
        from,
        price = String(10n ** 18n),
        transactionTimestamp,
        transactionHash,
        currency = wellKnownCurrencies.eth,
      } = {}) {
        function openseaDate(d) {
          return d.toISOString().replace(/Z$/, "000");
        }
        function paymentTokenForCurrency(currency) {
          return {
            name: currency.name,
            symbol: currency.symbol,
            address: currency.address,
            decimals: currency.decimals,
          };
        }
        return {
          asset: { address, token_id: String(tokenId) },
          id,
          winner_account: { address: to },
          seller: { address: from },
          transaction: {
            timestamp: openseaDate(transactionTimestamp),
            transaction_hash: transactionHash,
          },
          listing_time: openseaDate(listingTime),
          total_price: price,
          payment_token: paymentTokenForCurrency(currency),
          event_type: "successful",
        };
      }

      await eth.addBlocks({
        client,
        blocks: [
          {
            hash: dummyBlockHash(0),
            parentHash: ethers.constants.HashZero,
            number: 0,
            timestamp: ethers.BigNumber.from(Date.parse("2020-12-30") / 1000),
          },
          {
            hash: dummyBlockHash(1),
            parentHash: dummyBlockHash(0),
            number: 1,
            timestamp: ethers.BigNumber.from(Date.parse("2021-01-02") / 1000),
          },
          {
            hash: dummyBlockHash(2),
            parentHash: dummyBlockHash(1),
            number: 2,
            timestamp: ethers.BigNumber.from(Date.parse("2021-02-08") / 1000),
          },
          {
            hash: dummyBlockHash(3),
            parentHash: dummyBlockHash(2),
            number: 3,
            timestamp: ethers.BigNumber.from(Date.parse("2021-03-16") / 1000),
          },
        ],
      });

      let nextLogIndex = 101;
      function transfer({ to, from, blockNumber, tx } = {}) {
        return {
          tokenId,
          fromAddress: from,
          toAddress: to,
          blockHash: dummyBlockHash(blockNumber),
          logIndex: nextLogIndex++,
          transactionHash: tx,
        };
      }

      const zero = ethers.constants.AddressZero;
      const alice = dummyAddress("alice.eth");
      const bob = dummyAddress("bob.eth");
      const cheryl = dummyAddress("cheryl.eth");
      const cherylsVault = dummyAddress("vault.cheryl.eth");

      const transfers = [
        // Mint event
        transfer({ from: zero, to: alice, blockNumber: 0, tx: dummyTx(0) }),
        // Archipelago sale from Ailce to Bob
        transfer({ from: alice, to: bob, blockNumber: 1, tx: dummyTx(1) }),
        // OpenSea sale from Bob to Alice
        transfer({ from: bob, to: alice, blockNumber: 2, tx: dummyTx(2) }),
        // Atomic sale-and-transfer from Alice to Cheryl to Cheryl's vault
        transfer({ from: alice, to: cheryl, blockNumber: 3, tx: dummyTx(3) }),
        transfer({
          from: cheryl,
          to: cherylsVault,
          blockNumber: 3,
          tx: dummyTx(3), // same tx as previous: manual transfer away
        }),
      ];

      const marketContract = dummyAddress("market");
      const archipelagoFills = [
        {
          tradeId: ethers.utils.id("tradeid:1"),
          tokenContract: snapshots.THE_CUBE.tokenContract,
          onChainTokenId: snapshots.THE_CUBE.onChainTokenId,
          seller: alice,
          buyer: bob,
          currency: wellKnownCurrencies.weth9.address,
          price: "1000",
          proceeds: "995",
          cost: "1005",
          blockHash: dummyBlockHash(1),
          logIndex: transfers[1].logIndex,
          transactionHash: dummyTx(1),
        },
      ];

      const openseaSales = [
        openseaSale({
          from: bob,
          to: alice,
          listingTime: new Date("2020-06-06T00:00:00Z"),
          transactionHash: dummyTx(2),
          transactionTimestamp: new Date("2021-02-08T00:00:00Z"),
          price: String(10n ** 18n),
        }),
        openseaSale({
          from: alice,
          to: cheryl,
          listingTime: new Date("2021-02-07T00:00:00Z"),
          transactionHash: dummyTx(3),
          transactionTimestamp: new Date("2021-03-16T00:00:00Z"),
          price: String(2n * 10n ** 18n),
        }),
      ];

      await eth.addErc721Transfers({ client, transfers });
      await eth.addFills({ client, marketContract, fills: archipelagoFills });
      await openseaIngest.addRawEvents({ client, events: openseaSales });
      await openseaIngest.ingestEvents({ client });

      const res = await api.tokenHistory({ client, tokenId });
      expect(res).toEqual([
        // Initial mint event
        {
          type: "TRANSFER",
          blockNumber: 0,
          logIndex: 101,
          transactionHash: dummyTx(0),
          blockHash: dummyBlockHash(0),
          timestamp: new Date("2020-12-30"),
          from: ethers.constants.AddressZero,
          to: alice,
        },
        // Usual happy case: transaction with combined transfer and sale.
        {
          type: "SALE",
          venue: "ARCHIPELAGO",
          from: alice,
          to: bob,
          timestamp: new Date("2021-01-02T00:00:00Z"),
          transactionHash: dummyTx(1),
          priceWei: "1000",
        },
        // Same happy case with an OpenSea sale.
        {
          type: "OPENSEA_SALE",
          venue: "OPENSEA",
          from: bob,
          to: alice,
          timestamp: new Date("2021-02-08T00:00:00Z"),
          transactionHash: dummyTx(2),
          priceWei: String(10n ** 18n),
        },
        // Edge case: block with two transfers and a sale, which are
        // represented individually
        {
          type: "TRANSFER",
          blockNumber: 3,
          logIndex: 104,
          transactionHash: dummyTx(3),
          blockHash: dummyBlockHash(3),
          timestamp: new Date("2021-03-16T00:00:00Z"),
          from: alice,
          to: cheryl,
        },
        {
          type: "TRANSFER",
          blockNumber: 3,
          logIndex: 105,
          transactionHash: dummyTx(3),
          blockHash: dummyBlockHash(3),
          timestamp: new Date("2021-03-16T00:00:00Z"),
          from: cheryl,
          to: cherylsVault,
        },
        {
          type: "OPENSEA_SALE",
          venue: "OPENSEA",
          from: alice,
          to: cheryl,
          timestamp: new Date("2021-03-16T00:00:00Z"),
          transactionHash: dummyTx(3),
          priceWei: String(2n * 10n ** 18n),
        },
      ]);
    })
  );

  it(
    "counts transfers from one address to another",
    withTestDb(async ({ client }) => {
      const { archetypeId, squigglesId, theCube } = await setup(client);

      const zero = ethers.constants.AddressZero;
      const alice = ethers.utils.getAddress(
        ethers.utils.id("address:alice").slice(0, 42)
      );
      const blockHash = "0x" + "77".repeat(32);
      const block = {
        hash: blockHash,
        parentHash: ethers.constants.HashZero,
        number: 0,
        timestamp: 0,
      };
      await eth.addBlock({ client, block });
      const transfer = {
        tokenId: theCube,
        fromAddress: zero,
        toAddress: alice,
        blockHash,
        logIndex: 123,
        transactionHash: "0x" + "fe".repeat(32),
      };
      await eth.addErc721Transfers({ client, transfers: [transfer] });
      const res = await api.transferCount({
        client,
        fromAddress: zero,
        toAddress: alice,
      });
      expect(res).toEqual({ transfers: 1 });
    })
  );

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
    "generates appropriate collection info for autoglyphs",
    withTestDb(async ({ client }) => {
      const projectId = await addAutoglyphs({ client });
      const res = await api.collection({ client, slug: "autoglyphs" });
      expect(res).toEqual({
        projectId,
        slug: "autoglyphs",
        artblocksProjectIndex: null,
        imageUrlTemplate: expect.stringContaining("/autoglyphs/svg/"),
        name: "Autoglyphs",
        artistName: "Larva Labs",
        description: expect.stringContaining(
          "the first “on-chain” generative art"
        ),
        aspectRatio: 1,
        numTokens: 512,
        maxInvocations: 512,
        tokenContract: "0xd4e4078ca3495DE5B1d4dB434BEbc5a986197782",
        fees: [
          {
            micros: 5000,
            static: true,
            target: "0x1fC12C9f68A6B0633Ba5897A40A8e61ed9274dC9",
            includeInOrders: false,
          },
          {
            micros: 5000,
            static: true,
            target: "0xA76456bb6aBC50FB38e17c042026bc27a95C3314",
          },
        ],
      });
    })
  );

  it(
    "generates appropriate collection info for cryptoadz",
    withTestDb(async ({ client }) => {
      const projectId = await addCryptoadz({ client, testMode: true });
      const res = await api.collection({ client, slug: "cryptoadz" });
      expect(res).toEqual({
        projectId,
        slug: "cryptoadz",
        artblocksProjectIndex: null,
        imageUrlTemplate: expect.stringContaining("/cryptoadz/img/"),
        name: "CrypToadz",
        artistName: "GREMPLIN",
        description: expect.stringContaining(
          "amphibious creatures trying to escape"
        ),
        aspectRatio: 1,
        numTokens: 6969,
        maxInvocations: 6969,
        tokenContract: "0x1CB1A5e65610AEFF2551A50f76a87a7d3fB649C6",
        fees: [
          {
            micros: 5000,
            static: true,
            target: "0x1fC12C9f68A6B0633Ba5897A40A8e61ed9274dC9",
            includeInOrders: false,
          },
          {
            micros: 5000,
            static: true,
            target: "0xA76456bb6aBC50FB38e17c042026bc27a95C3314",
          },
          {
            micros: 25000,
            static: true,
            target: "0x87757c7fD54D892176e9ECEc6767Bc16e04a06a8",
          },
        ],
      });
    })
  );

  it(
    "blockAlignedTraitMembers works",
    withTestDb(async ({ client }) => {
      const { projectId } = await sc.addProject(client, snapshots.ARCHETYPE);
      const tokenIndexToTokenId = new Map();
      for (const i of [0, 1, 255, 256]) {
        const tokenId = await tokens.addBareToken({
          client,
          projectId,
          tokenIndex: i,
          onChainTokenId: 23000000 + i,
        });
        tokenIndexToTokenId.set(i, tokenId);
        const featureData = {
          mod2: i % 2 === 0 ? "true" : "false",
        };
        await tokens.setTokenTraits({ client, tokenId, featureData });
      }
      const traitInfo = await api.resolveTraitIds({
        client,
        projectId,
        keys: [
          { featureName: "mod2", traitValue: "true" },
          { featureName: "mod2", traitValue: "false" },
        ],
      });
      // verify that these are in insertion order so that we can easily pluck the IDs
      expect(
        traitInfo.map((x) => ({
          featureName: x.featureName,
          traitValue: x.traitValue,
        }))
      ).toEqual([
        { featureName: "mod2", traitValue: "true" },
        { featureName: "mod2", traitValue: "false" },
      ]);
      const traitIds = traitInfo.map((x) => x.traitId);
      const [mod2True, mod2False] = traitIds;
      // Test that we get the first block of results whether we use
      // the 0th, 128th, or 255th token id
      const members1 = await api.blockAlignedTraitMembers({
        client,
        traitIds,
        tokenId: tokenIndexToTokenId.get(0),
      });
      const members2 = await api.blockAlignedTraitMembers({
        client,
        traitIds,
        tokenId: tokenIndexToTokenId.get(1),
      });
      const members3 = await api.blockAlignedTraitMembers({
        client,
        traitIds,
        tokenId: tokenIndexToTokenId.get(255),
      });
      const expected0 = [
        { traitId: mod2True, tokenIndices: [0] },
        { traitId: mod2False, tokenIndices: [1, 255] },
      ];
      expect(members1).toEqual(expected0);
      expect(members2).toEqual(expected0);
      expect(members3).toEqual(expected0);
      // also check we get the next block once we hit index 256
      const expected256 = [
        { traitId: mod2True, tokenIndices: [256] },
        { traitId: mod2False, tokenIndices: [] },
      ];
      const members4 = await api.blockAlignedTraitMembers({
        client,
        traitIds,
        tokenId: tokenIndexToTokenId.get(256),
      });
      expect(members4).toEqual(expected256);
    })
  );
});
