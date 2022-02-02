const ethers = require("ethers");

const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const emails = require("../db/emails");
const erc721Transfers = require("../db/erc721Transfers");
const openseaIngest = require("../db/opensea/ingestEvents");
const wellKnownCurrencies = require("../db/wellKnownCurrencies");
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
    "provides project tokens",
    withTestDb(async ({ client }) => {
      const project = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const projectId = await artblocks.addProject({ client, project });
      const [a1, a2, a3] = [
        snapshots.ARCH_TRIPTYCH_1,
        snapshots.ARCH_TRIPTYCH_2,
        snapshots.ARCH_TRIPTYCH_3,
      ];
      const ids = new Map();
      // Add them out of order; make sure that the output is still sorted by
      // token index.
      for (const tokenId of [a3, a2, a1]) {
        const rawTokenData = await sc.token(tokenId);
        const id = await artblocks.addToken({
          client,
          artblocksTokenId: tokenId,
          rawTokenData,
        });
        ids.set(tokenId, id);
      }
      const res = await api.collectionTokens({ client, slug: "archetype" });
      expect(res).toEqual(
        [a1, a2, a3].map((abid) => ({
          tokenId: ids.get(abid),
          tokenIndex: abid % 1e6,
        }))
      );
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

  it(
    "provides a unified history of sales and transfers",
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

      let nextOpenseaSaleId = 1;
      function openseaSale({
        id = String(nextOpenseaSaleId++),
        address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        tokenId = snapshots.THE_CUBE,
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

      const nBlocks = await erc721Transfers.addBlocks({
        client,
        blocks: [
          {
            hash: dummyBlockHash(777),
            number: ethers.BigNumber.from(777),
            timestamp: ethers.BigNumber.from(Date.parse("2020-12-30") / 1000),
          },
          {
            hash: dummyBlockHash(888),
            number: ethers.BigNumber.from(888),
            timestamp: ethers.BigNumber.from(Date.parse("2021-01-02") / 1000),
          },
          {
            hash: dummyBlockHash(999),
            number: ethers.BigNumber.from(999),
            timestamp: ethers.BigNumber.from(Date.parse("2021-02-08") / 1000),
          },
        ],
      });
      expect(nBlocks).toEqual(3);

      let nextLogIndex = 101;
      function transfer({
        contractAddress = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
        tokenId = snapshots.THE_CUBE,
        to,
        from = ethers.constants.AddressZero,
        blockNumber,
        tx,
      } = {}) {
        const eventSignature = "Transfer(address,address,uint256)";
        const transferTopic = ethers.utils.id(eventSignature);
        function pad(value, type) {
          return ethers.utils.defaultAbiCoder.encode([type], [value]);
        }
        const blockHash = dummyBlockHash(blockNumber);
        return {
          args: [from, to, ethers.BigNumber.from(tokenId)],
          data: "0x",
          event: "Transfer",
          topics: [
            transferTopic,
            pad(from, "address"),
            pad(to, "address"),
            pad(tokenId, "uint256"),
          ],
          address: contractAddress,
          removed: false,
          logIndex: nextLogIndex++,
          blockHash: dummyBlockHash(blockNumber),
          blockNumber,
          eventSignature,
          transactionHash: tx,
          transactionIndex: 0,
        };
      }

      const alice = dummyAddress("alice.eth");
      const bob = dummyAddress("bob.eth");
      const cheryl = dummyAddress("cheryl.eth");
      const cherylsVault = dummyAddress("vault.cheryl.eth");

      const transfers = [
        transfer({ to: alice, blockNumber: 777, tx: dummyTx(1) }),
        transfer({ from: alice, to: bob, blockNumber: 888, tx: dummyTx(2) }),
        transfer({ from: bob, to: cheryl, blockNumber: 999, tx: dummyTx(3) }),
        transfer({
          from: cheryl,
          to: cherylsVault,
          blockNumber: 999,
          tx: dummyTx(3), // same tx as previous: manual transfer away
        }),
      ];

      const openseaSales = [
        openseaSale({
          from: alice,
          to: bob,
          listingTime: new Date("2021-01-01T00:00:00Z"),
          transactionHash: dummyTx(2),
          transactionTimestamp: new Date("2021-01-02T00:00:00Z"),
          price: String(10n ** 18n),
        }),
        openseaSale({
          from: bob,
          to: cheryl,
          listingTime: new Date("2021-02-07T00:00:00Z"),
          transactionHash: dummyTx(3),
          transactionTimestamp: new Date("2021-02-08T00:00:00Z"),
          price: String(2n * 10n ** 18n),
        }),
      ];

      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      await artblocks.addProject({ client, project: archetype });

      const theCube = await sc.token(snapshots.THE_CUBE);
      const tokenId = await artblocks.addToken({
        client,
        artblocksTokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });

      await erc721Transfers.addTransfers({ client, transfers });
      await openseaIngest.addRawEvents({ client, events: openseaSales });
      await openseaIngest.ingestEvents({ client });

      const res = await api.tokenHistory({ client, tokenId });
      expect(res).toEqual([
        // Initial mint event
        {
          type: "TRANSFER",
          blockNumber: 777,
          logIndex: 101,
          transactionHash: dummyTx(1),
          blockHash: dummyBlockHash(777),
          timestamp: new Date("2020-12-30"),
          from: ethers.constants.AddressZero,
          to: alice,
        },
        // Usual happy case: transaction with combined transfer and sale
        {
          type: "OPENSEA_SALE",
          from: alice,
          to: bob,
          timestamp: new Date("2021-01-02T00:00:00Z"),
          transactionHash: dummyTx(2),
          priceWei: String(10n ** 18n),
        },
        // Edge case: block with two transfers and a sale, which are
        // represented individually
        {
          type: "TRANSFER",
          blockNumber: 999,
          logIndex: 103,
          transactionHash: dummyTx(3),
          blockHash: dummyBlockHash(999),
          timestamp: new Date("2021-02-08T00:00:00Z"),
          from: bob,
          to: cheryl,
        },
        {
          type: "TRANSFER",
          blockNumber: 999,
          logIndex: 104,
          transactionHash: dummyTx(3),
          blockHash: dummyBlockHash(999),
          timestamp: new Date("2021-02-08T00:00:00Z"),
          from: cheryl,
          to: cherylsVault,
        },
        {
          type: "OPENSEA_SALE",
          from: bob,
          to: cheryl,
          timestamp: new Date("2021-02-08T00:00:00Z"),
          transactionHash: dummyTx(3),
          priceWei: String(2n * 10n ** 18n),
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
    const output = api.sortAsciinumeric(input, (trait) => trait.slug);
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
