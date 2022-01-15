const ethers = require("ethers");

const { bufToHex, hexToBuf } = require("../util");
const {
  addRawEvents,
  ingestEvents,
  deactivateExpiredAsks,
} = require("./ingestEvents");
const {
  askForToken,
  floorAskByProject,
  aggregateSalesByProject,
  asksForProject,
} = require("./api");
const artblocks = require("../artblocks");
const { addTransfers } = require("../erc721Transfers");
const { testDbProvider } = require("../testUtil");
const snapshots = require("../../scrape/snapshots");
const { parseProjectData } = require("../../scrape/fetchArtblocksProject");
const wellKnownCurrencies = require("../wellKnownCurrencies");

describe("db/opensea/api", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addAndIngest(client, events) {
    await addRawEvents({ client, events });
    await ingestEvents({ client });
  }

  function utcDateFromString(x) {
    return new Date(x + "Z");
  }

  const dandelion = "0xe03a5189dac8182085e4adf66281f679fff2291d";
  const wchargin = "0xefa7bdd92b5e9cd9de9b54ac0e3dc60623f1c989";
  const ijd = "0xbaaf7c84deb0184ffbf7fc1655cb38264a29296f";
  const listed = "2021-03-01T00:00:00.123456";
  const sold = "2021-03-03T12:34:56.123456";

  function sale({
    id = "2",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    listingTime = listed,
    toAddress = dandelion,
    fromAddress = wchargin,
    price = "1000000000000000000",
    transactionTimestamp = sold,
    transactionHash = "0xef7e95ce1c085611cb5186a55cec026cd3f2f266c1f581bb6a9e9258cf3019f4",
    currency = wellKnownCurrencies.eth,
  } = {}) {
    return {
      asset: { address, token_id: String(tokenId) },
      id,
      winner_account: { address: toAddress },
      seller: { address: fromAddress },
      transaction: {
        timestamp: transactionTimestamp,
        transaction_hash: transactionHash,
      },
      listing_time: listingTime,
      total_price: price,
      payment_token: paymentTokenForCurrency(currency),
      event_type: "successful",
    };
  }

  function ask({
    id = "3",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    listingTime = listed,
    duration = null,
    sellerAddress = wchargin,
    price = "1000000000000000000",
    currency = wellKnownCurrencies.eth,
  } = {}) {
    return {
      asset: { address, token_id: String(tokenId) },
      id,
      seller: { address: sellerAddress },
      listing_time: listingTime,
      duration,
      starting_price: price,
      auction_type: "dutch",
      payment_token: paymentTokenForCurrency(currency),
      event_type: "created",
    };
  }

  function transfer({
    contractAddress = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    fromAddress = ethers.constants.AddressZero,
    toAddress = wchargin,
    blockNumber = 12164300,
    blockHash = "0x" + "ba".repeat(32),
    logIndex = 123,
    transactionHash = "0x" + "fe".repeat(32),
    transactionIndex = 77,
  } = {}) {
    const eventSignature = "Transfer(address,address,uint256)";
    const transferTopic = ethers.utils.id(eventSignature);
    function pad(value, type) {
      return ethers.utils.defaultAbiCoder.encode([type], [value]);
    }
    return {
      args: [fromAddress, toAddress, ethers.BigNumber.from(tokenId)],
      data: "0x",
      event: "Transfer",
      topics: [
        transferTopic,
        pad(fromAddress, "address"),
        pad(toAddress, "address"),
        pad(tokenId, "uint256"),
      ],
      address: contractAddress,
      removed: false,
      logIndex,
      blockHash,
      blockNumber,
      eventSignature,
      transactionHash,
      transactionIndex,
    };
  }

  async function exampleProjectAndToken({ client }) {
    const archetypeProject = parseProjectData(
      snapshots.ARCHETYPE,
      await sc.project(snapshots.ARCHETYPE)
    );
    const archetypeId = await artblocks.addProject({
      client,
      project: archetypeProject,
    });
    const archetypeTokenId1 = await artblocks.addToken({
      client,
      artblocksTokenId: snapshots.THE_CUBE,
      rawTokenData: await sc.token(snapshots.THE_CUBE),
    });
    const archetypeTokenId2 = await artblocks.addToken({
      client,
      artblocksTokenId: snapshots.ARCH_TRIPTYCH_1,
      rawTokenData: await sc.token(snapshots.ARCH_TRIPTYCH_1),
    });
    const squigglesProject = parseProjectData(
      snapshots.SQUIGGLES,
      await sc.project(snapshots.SQUIGGLES)
    );
    const squigglesId = await artblocks.addProject({
      client,
      project: squigglesProject,
    });
    const squiggleTokenId = await artblocks.addToken({
      client,
      artblocksTokenId: snapshots.PERFECT_CHROMATIC,
      rawTokenData: await sc.token(snapshots.PERFECT_CHROMATIC),
    });
    return {
      archetypeId,
      archetypeTokenId1,
      archetypeTokenId2,
      squigglesId,
      squiggleTokenId,
    };
  }

  function paymentTokenForCurrency(currency) {
    return {
      name: currency.name,
      symbol: currency.symbol,
      address: currency.address,
      decimals: currency.decimals,
    };
  }
  async function getActive(client, id) {
    const res = await client.query(
      `
          SELECT active
          FROM opensea_asks
          WHERE event_id = $1
          `,
      [id]
    );
    if (res.rows.length == 0) {
      throw new Error("unexpected");
    }
    return res.rows[0].active;
  }

  describe("askForToken", () => {
    it(
      "returns null if there are no asks",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const result = await askForToken({
          client,
          tokenId: archetypeTokenId1,
        });
        expect(result).toBe(null);
      })
    );
    it(
      "returns lowest ask as expected",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const a1 = ask({ id: "1", price: "1000" });
        const a2 = ask({ id: "2", price: "950" });
        const a3 = ask({ id: "3", price: "950" });
        await addAndIngest(client, [a1, a2]);

        const t = transfer();
        await addTransfers({ client, transfers: [t] });

        const result = await askForToken({
          client,
          tokenId: archetypeTokenId1,
        });
        expect(result).toEqual({
          expirationTime: null,
          listingTime: utcDateFromString(listed),
          price: 950n,
          sellerAddress: wchargin,
          tokenId: archetypeTokenId1,
        });
      })
    );
    it(
      "ignores non-active asks",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", price: "1000" });
        const s = sale({ id: "2" });
        await addAndIngest(client, [a, s]);
        const t = transfer();
        await addTransfers({ client, transfers: [t] });
        const result = await askForToken({
          client,
          tokenId: archetypeTokenId1,
        });
        expect(result).toEqual(null);
      })
    );
    it(
      "ignores expired asks, even if still marked active in db",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", price: "1000", duration: 100 });
        await addAndIngest(client, [a]);

        // not active because it's expired
        expect(await getActive(client, "1")).toBe(false);
        // manually set it as active, simulating the case where it's just recently
        // expired but we didn't update the db field yet
        await client.query(`UPDATE opensea_asks SET active=true`);
        expect(await getActive(client, "1")).toBe(true);

        const t = transfer();
        await addTransfers({ client, transfers: [t] });

        const result = await askForToken({
          client,
          tokenId: archetypeTokenId1,
        });
        expect(result).toEqual(null);
      })
    );
    it(
      "ignores asks not from the current holder",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const a1 = ask({ id: "1", price: "1000", sellerAddress: wchargin });
        const s = sale({
          id: "2",
          fromAddress: wchargin,
          toAddress: dandelion,
        });
        const a2 = ask({
          id: "3",
          price: "800",
          listingTime: new Date(
            Date.parse(utcDateFromString(sold)) + 2000
          ).toISOString(),
          sellerAddress: wchargin, // not the current holder
        });
        await addAndIngest(client, [a1, s, a2]);
        const t = transfer({ fromAddress: wchargin, toAddress: dandelion });
        await addTransfers({ client, transfers: [t] });
        const result = await askForToken({
          client,
          tokenId: archetypeTokenId1,
        });
        expect(result).toEqual(null);
      })
    );
  });

  describe("floorAskByProject", () => {
    it(
      "returns null if there are no asks",
      withTestDb(async ({ client }) => {
        const { archetypeId, squigglesId } = await exampleProjectAndToken({
          client,
        });
        const result = await floorAskByProject({
          client,
        });
        expect(result).toEqual({
          [archetypeId]: null,
          [squigglesId]: null,
        });
      })
    );
    it(
      "returns lowest ask across multiple tokens",
      withTestDb(async ({ client }) => {
        const { archetypeId, squigglesId } = await exampleProjectAndToken({
          client,
        });
        const a1 = ask({
          id: "1",
          price: "1000",
          tokenId: snapshots.THE_CUBE,
          sellerAddress: dandelion,
        });
        const a2 = ask({
          id: "2",
          price: "950",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          sellerAddress: dandelion,
        });
        const a3 = ask({
          id: "3",
          price: "55",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          sellerAddress: ijd,
        });
        const t1 = transfer({
          tokenId: snapshots.THE_CUBE,
          toAddress: dandelion,
          logIndex: 123,
          transactionIndex: 77,
        });
        const t2 = transfer({
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          toAddress: dandelion,
          logIndex: 124,
          transactionIndex: 78,
        });
        await addTransfers({ client, transfers: [t1, t2] });
        await addAndIngest(client, [a1, a2, a3]);
        const result = await floorAskByProject({
          client,
        });
        expect(result).toEqual({
          [archetypeId]: 950n,
          [squigglesId]: null,
        });
      })
    );
    it(
      "ignores non-active asks",
      withTestDb(async ({ client }) => {
        const { archetypeId, squigglesId } = await exampleProjectAndToken({
          client,
        });
        // Suppose that a token is sold from A to B, then transferred
        // back to A. The ask will be marked inactive, and so shouldn't
        // factor in even though the token is owned by the asker.
        const a = ask({ id: "1", price: "1000" });
        const s = sale({ id: "2" });
        const t = transfer();
        await addTransfers({ client, transfers: [t] });
        await addAndIngest(client, [a, s]);
        const result = await floorAskByProject({
          client,
        });
        expect(result).toEqual({
          [archetypeId]: null,
          [squigglesId]: null,
        });
      })
    );
    it(
      "ignores expired asks, even if still marked as active in db",
      withTestDb(async ({ client }) => {
        const { archetypeId, squigglesId } = await exampleProjectAndToken({
          client,
        });
        const a = ask({ id: "1", price: "1000", duration: 100 });
        const t = transfer();
        await addTransfers({ client, transfers: [t] });
        await addAndIngest(client, [a]);

        // not active because it's expired
        expect(await getActive(client, "1")).toBe(false);
        // manually set it as active, simulating the case where it's just recently
        // expired but we didn't update the db field yet
        await client.query(`UPDATE opensea_asks SET active=true`);
        expect(await getActive(client, "1")).toBe(true);

        const result = await floorAskByProject({
          client,
        });
        // It's still expired :)
        expect(result).toEqual({
          [archetypeId]: null,
          [squigglesId]: null,
        });
      })
    );
    it(
      "restricts to specified projectIds, if provided",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({
          client,
        });
        const result = await floorAskByProject({
          client,
          projectIds: [archetypeId],
        });
        expect(result).toEqual({
          [archetypeId]: null,
        });
      })
    );
  });

  describe("asksForProject", () => {
    it(
      "returns empty object if there are no tokens for sale",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({
          client,
        });
        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({});
      })
    );
    it(
      "ignores inactive asks",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({
          client,
        });
        const a = ask({ id: "1", price: "1000" });
        const s = sale({ id: "2" });
        await addAndIngest(client, [a, s]);
        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({});
      })
    );
    it(
      "ignores expired asks, even if still marked active in db",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({
          client,
        });
        const a = ask({ id: "1", price: "1000", duration: 100 });
        await addAndIngest(client, [a]);

        // not active because it's expired
        expect(await getActive(client, "1")).toBe(false);
        // manually set it as active, simulating the case where it's just recently
        // expired but we didn't update the db field yet
        await client.query(`UPDATE opensea_asks SET active=true`);
        expect(await getActive(client, "1")).toBe(true);
        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({});
      })
    );
    it(
      "works in a case with some open asks",
      withTestDb(async ({ client }) => {
        const { archetypeId, archetypeTokenId1, archetypeTokenId2 } =
          await exampleProjectAndToken({
            client,
          });
        const a1 = ask({ id: "1", price: "500", tokenId: snapshots.THE_CUBE });
        const a2 = ask({
          id: "2",
          price: "1000",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
        });
        await addAndIngest(client, [a1, a2]);

        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({
          [archetypeTokenId1]: 500n,
          [archetypeTokenId2]: 1000n,
        });
      })
    );
    it(
      "shows lowest ask for a token if there are several",
      withTestDb(async ({ client }) => {
        const { archetypeId, archetypeTokenId1 } = await exampleProjectAndToken(
          {
            client,
          }
        );
        const a1 = ask({ id: "1", price: "5000" });
        const a2 = ask({ id: "2", price: "100" });
        const a3 = ask({ id: "3", price: "1000" });
        await addAndIngest(client, [a1, a2, a3]);

        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({
          [archetypeTokenId1]: 100n,
        });
      })
    );
  });

  describe("aggregateSalesByProject", () => {
    it(
      "returns empty array if there are no projects",
      withTestDb(async ({ client }) => {
        expect(await aggregateSalesByProject({ client })).toEqual([]);
      })
    );
    it(
      "does not include projects with no sales",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        expect(await aggregateSalesByProject({ client })).toEqual([]);
      })
    );
    it(
      "aggregates sales across tokens in a project",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({ client });
        const s1 = sale({
          id: "1",
          tokenId: snapshots.THE_CUBE,
          price: "1000",
        });
        const s2 = sale({
          id: "2",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
        });
        await addAndIngest(client, [s1, s2]);
        expect(await aggregateSalesByProject({ client })).toEqual([
          { projectId: archetypeId, totalEthSales: 1500n },
        ]);
      })
    );
    it(
      "aggregates ETH and WETH sales, but ignores other currencies",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({ client });
        const s1 = sale({
          id: "1",
          tokenId: snapshots.THE_CUBE,
          price: "1000",
          currency: wellKnownCurrencies.eth,
        });
        const s2 = sale({
          id: "2",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
          currency: wellKnownCurrencies.weth9,
        });
        const s3 = sale({
          id: "3",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          price: "99",
          currency: wellKnownCurrencies.usdc,
        });
        await addAndIngest(client, [s1, s2, s3]);
        expect(await aggregateSalesByProject({ client })).toEqual([
          { projectId: archetypeId, totalEthSales: 1500n },
        ]);
      })
    );
    it(
      "filters only sales after the target date, if specified",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({ client });
        const s1 = sale({
          id: "1",
          tokenId: snapshots.THE_CUBE,
          price: "1000",
          currency: wellKnownCurrencies.eth,
          transactionTimestamp: "2020-01-01",
        });
        const s2 = sale({
          id: "2",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
          currency: wellKnownCurrencies.weth9,
          transactionTimestamp: "2021-02-02",
        });
        await addAndIngest(client, [s1, s2]);
        expect(
          await aggregateSalesByProject({
            client,
            afterDate: new Date("2021-01-01"),
          })
        ).toEqual([{ projectId: archetypeId, totalEthSales: 500n }]);
      })
    );
    it(
      "handles the case with multiple projects",
      withTestDb(async ({ client }) => {
        const { archetypeId, squigglesId } = await exampleProjectAndToken({
          client,
        });
        const s1 = sale({
          id: "1",
          tokenId: snapshots.THE_CUBE,
          price: "1000",
        });
        const s2 = sale({
          id: "2",
          tokenId: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
        });
        const s3 = sale({
          id: "3",
          tokenId: snapshots.PERFECT_CHROMATIC,
          address: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
          price: "99",
        });
        await addAndIngest(client, [s1, s2, s3]);
        expect(await aggregateSalesByProject({ client })).toEqual([
          { projectId: archetypeId, totalEthSales: 1500n },
          { projectId: squigglesId, totalEthSales: 99n },
        ]);
      })
    );
  });
});
