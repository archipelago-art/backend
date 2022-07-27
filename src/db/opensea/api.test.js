const ethers = require("ethers");

const { bufToHex, hexToBuf } = require("../util");
const {
  addRawEvents,
  ingestEvents,
  deactivateExpiredAsks,
} = require("./ingestEvents");
const {
  askForToken,
  asksForToken,
  floorAskByProject,
  aggregateSalesByProject,
  lastSalesByProject,
  asksForProject,
  unlistedOpenseaAsks,
} = require("./api");
const artblocks = require("../artblocks");
const eth = require("../eth");
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

  function dateToOpenseaString(d) {
    // 2001-02-03T04:05:06.789Z -> 2001-02-03T04:05:06.789000
    return d.toISOString().replace("Z", "000");
  }
  function utcDateFromString(x) {
    return new Date(x + "Z");
  }

  function dummyBlockHash(blockNumber) {
    return ethers.utils.id(`block:${blockNumber}`);
  }

  const dandelion = "0xE03a5189dAC8182085e4aDF66281F679fFf2291D";
  const wchargin = "0xEfa7bDD92B5e9CD9dE9b54AC0e3dc60623F1C989";
  const ijd = "0xBAaF7C84dEb0184FfBF7Fc1655cb38264a29296f";
  const listed = "2023-03-01T00:00:00.123456";
  const sold = "2023-03-03T12:34:56.123456";

  function sale({
    id = "2",
    tokenSpec = snapshots.THE_CUBE,
    listingTime = listed,
    toAddress = dandelion,
    fromAddress = wchargin,
    price = "1000000000000000000",
    transactionTimestamp = sold,
    transactionHash = "0xef7e95ce1c085611cb5186a55cec026cd3f2f266c1f581bb6a9e9258cf3019f4",
    currency = wellKnownCurrencies.eth,
  } = {}) {
    const address = tokenSpec.tokenContract;
    const tokenId = tokenSpec.onChainTokenId;
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
    tokenSpec = snapshots.THE_CUBE,
    listingTime = listed,
    duration = null,
    sellerAddress = wchargin,
    price = "1000000000000000000",
    currency = wellKnownCurrencies.eth,
  } = {}) {
    const address = tokenSpec.tokenContract;
    const tokenId = tokenSpec.onChainTokenId;
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

  function genesis() {
    return {
      hash: dummyBlockHash(0),
      parentHash: ethers.constants.HashZero,
      number: 0,
      timestamp: ethers.BigNumber.from(Date.parse("2020-12-30") / 1000),
    };
  }
  function transfer({
    tokenId,
    from = ethers.constants.AddressZero,
    to = wchargin,
    blockNumber = 0,
    logIndex = 123,
    tx = "0x" + "fe".repeat(32),
  } = {}) {
    return {
      tokenId,
      fromAddress: from,
      toAddress: to,
      blockHash: dummyBlockHash(blockNumber),
      logIndex,
      transactionHash: tx,
    };
  }

  async function exampleProjectAndToken({ client }) {
    const [{ projectId: archetypeId }, { projectId: squigglesId }] =
      await sc.addProjects(client, [snapshots.ARCHETYPE, snapshots.SQUIGGLES]);
    const [
      { tokenId: archetypeTokenId1 },
      { tokenId: archetypeTokenId2 },
      { tokenId: archetypeTokenId3 },
      { tokenId: squiggleTokenId },
    ] = await sc.addTokens(client, [
      snapshots.THE_CUBE,
      snapshots.ARCH_TRIPTYCH_1,
      snapshots.ARCH_TRIPTYCH_2,
      snapshots.PERFECT_CHROMATIC,
    ]);
    return {
      archetypeId,
      archetypeTokenId1,
      archetypeTokenId2,
      archetypeTokenId3,
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

  describe("askForToken / asksForToken", () => {
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

        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });

        const result = await askForToken({
          client,
          tokenId: archetypeTokenId1,
        });
        expect(result).toEqual({
          eventId: "2",
          deadline: null,
          listingTime: utcDateFromString(listed),
          price: "950",
          sellerAddress: wchargin,
          tokenId: archetypeTokenId1,
        });
      })
    );
    it(
      "returns multiple lowest asks as expected",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const a1 = ask({ id: "1", price: "1000" });
        const a2 = ask({ id: "2", price: "950" });
        const a3 = ask({ id: "3", price: "975" });
        await addAndIngest(client, [a1, a2, a3]);

        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });

        const result = await asksForToken({
          client,
          tokenId: archetypeTokenId1,
          limit: 2,
        });
        expect(result).toEqual([
          {
            eventId: "2",
            deadline: null,
            listingTime: utcDateFromString(listed),
            price: "950",
            sellerAddress: wchargin,
            tokenId: archetypeTokenId1,
          },
          {
            eventId: "3",
            deadline: null,
            listingTime: utcDateFromString(listed),
            price: "975",
            sellerAddress: wchargin,
            tokenId: archetypeTokenId1,
          },
        ]);
      })
    );
    it(
      "ignores non-active asks",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", price: "1000" });
        const s = sale({ id: "2" });
        await addAndIngest(client, [a, s]);
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });
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
        const listingTime = "2022-03-01T00:00:00.123456";
        const a = ask({
          id: "1",
          price: "1000",
          duration: 1,
          listingTime,
        });
        await addAndIngest(client, [a]);

        // not active because it's expired
        expect(await getActive(client, "1")).toBe(false);
        // manually set it as active, simulating the case where it's just recently
        // expired but we didn't update the db field yet
        await client.query(`UPDATE opensea_asks SET active=true`);
        expect(await getActive(client, "1")).toBe(true);

        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });

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
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({
          tokenId: archetypeTokenId1,
          from: wchargin,
          to: dandelion,
        });
        await eth.addErc721Transfers({ client, transfers: [t] });
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
        const {
          archetypeId,
          archetypeTokenId1,
          archetypeTokenId2,
          squigglesId,
        } = await exampleProjectAndToken({
          client,
        });
        const a1 = ask({
          id: "1",
          price: "1000",
          tokenSpec: snapshots.THE_CUBE,
          sellerAddress: dandelion,
        });
        const a2 = ask({
          id: "2",
          price: "950",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          sellerAddress: dandelion,
        });
        const a3 = ask({
          id: "3",
          price: "55",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          sellerAddress: ijd,
        });
        await eth.addBlock({ client, block: genesis() });
        const t1 = transfer({
          tokenId: archetypeTokenId1,
          to: dandelion,
          logIndex: 123,
          transactionIndex: 77,
        });
        const t2 = transfer({
          tokenId: archetypeTokenId2,
          to: dandelion,
          logIndex: 124,
          transactionIndex: 78,
        });
        await eth.addErc721Transfers({ client, transfers: [t1, t2] });
        await addAndIngest(client, [a1, a2, a3]);
        const result = await floorAskByProject({
          client,
        });
        expect(result).toEqual({
          [archetypeId]: "950",
          [squigglesId]: null,
        });
      })
    );
    it(
      "ignores non-active asks",
      withTestDb(async ({ client }) => {
        const { archetypeId, squigglesId, archetypeTokenId1 } =
          await exampleProjectAndToken({
            client,
          });
        // Suppose that a token is sold from A to B, then transferred
        // back to A. The ask will be marked inactive, and so shouldn't
        // factor in even though the token is owned by the asker.
        const a = ask({ id: "1", price: "1000" });
        const s = sale({ id: "2" });
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });
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
        const { archetypeId, squigglesId, archetypeTokenId1 } =
          await exampleProjectAndToken({
            client,
          });
        const listingTime = "2022-03-01T00:00:00.123456";
        const a = ask({ id: "1", price: "1000", duration: 100, listingTime });
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });
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
        const { archetypeId, archetypeTokenId1 } = await exampleProjectAndToken(
          {
            client,
          }
        );
        const a = ask({ id: "1", price: "1000" });
        const s = sale({ id: "2" });
        await addAndIngest(client, [a, s]);
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });
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
        const { archetypeId, archetypeTokenId1 } = await exampleProjectAndToken(
          {
            client,
          }
        );
        const listingTime = "2022-03-01T00:00:00.123456";
        const a = ask({ id: "1", price: "1000", duration: 100, listingTime });
        await addAndIngest(client, [a]);
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });

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
        const {
          archetypeId,
          archetypeTokenId1,
          archetypeTokenId2,
          archetypeTokenId3,
        } = await exampleProjectAndToken({
          client,
        });
        const a1 = ask({
          id: "1",
          price: "500",
          tokenSpec: snapshots.THE_CUBE,
          listingTime: dateToOpenseaString(new Date("2023-01-01")),
        });
        const a2 = ask({
          id: "2",
          price: "1000",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          sellerAddress: dandelion, // wrong owner
          listingTime: dateToOpenseaString(new Date("2023-02-02")),
        });
        const a3 = ask({
          id: "3",
          price: "900",
          tokenSpec: snapshots.ARCH_TRIPTYCH_2,
          listingTime: dateToOpenseaString(new Date("2023-03-03")),
        });
        await addAndIngest(client, [a1, a2, a3]);
        const t1 = transfer({ tokenId: archetypeTokenId1, logIndex: 123 });
        const t2 = transfer({
          tokenId: archetypeTokenId2,
          from: wchargin, // not asker
          logIndex: 124,
        });
        const t3 = transfer({ tokenId: archetypeTokenId3, logIndex: 125 });
        await eth.addBlock({ client, block: genesis() });
        await eth.addErc721Transfers({ client, transfers: [t1, t2, t3] });

        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({
          [archetypeTokenId1]: {
            priceWei: "500",
            listingTime: new Date("2023-01-01"),
          },
          [archetypeTokenId3]: {
            priceWei: "900",
            listingTime: new Date("2023-03-03"),
          },
        });
      })
    );
    it(
      "shows lowest ask for a token if there are several",
      withTestDb(async ({ client }) => {
        const { archetypeId, archetypeTokenId1 } = await exampleProjectAndToken(
          { client }
        );
        const a1 = ask({
          id: "1",
          price: "5000",
          listingTime: dateToOpenseaString(new Date("2023-01-01")),
        });
        const a2 = ask({
          id: "2",
          price: "100",
          listingTime: dateToOpenseaString(new Date("2023-02-02")),
        });
        const a3 = ask({
          id: "3",
          price: "1000",
          listingTime: dateToOpenseaString(new Date("2023-03-03")),
        });
        await addAndIngest(client, [a1, a2, a3]);
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1 });
        await eth.addErc721Transfers({ client, transfers: [t] });

        const result = await asksForProject({
          client,
          projectId: archetypeId,
        });
        expect(result).toEqual({
          [archetypeTokenId1]: {
            priceWei: "100",
            listingTime: new Date("2023-02-02"),
          },
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
          tokenSpec: snapshots.THE_CUBE,
          price: "1000",
        });
        const s2 = sale({
          id: "2",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
        });
        await addAndIngest(client, [s1, s2]);
        expect(await aggregateSalesByProject({ client })).toEqual([
          { projectId: archetypeId, totalEthSales: "1500" },
        ]);
      })
    );
    it(
      "aggregates ETH and WETH sales, but ignores other currencies",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({ client });
        const s1 = sale({
          id: "1",
          tokenSpec: snapshots.THE_CUBE,
          price: "1000",
          currency: wellKnownCurrencies.eth,
        });
        const s2 = sale({
          id: "2",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
          currency: wellKnownCurrencies.weth9,
        });
        const s3 = sale({
          id: "3",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "99",
          currency: wellKnownCurrencies.usdc,
        });
        await addAndIngest(client, [s1, s2, s3]);
        expect(await aggregateSalesByProject({ client })).toEqual([
          { projectId: archetypeId, totalEthSales: "1500" },
        ]);
      })
    );
    it(
      "filters only sales after the target date, if specified",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({ client });
        const s1 = sale({
          id: "1",
          tokenSpec: snapshots.THE_CUBE,
          price: "1000",
          currency: wellKnownCurrencies.eth,
          transactionTimestamp: "2020-01-01",
        });
        const s2 = sale({
          id: "2",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
          currency: wellKnownCurrencies.weth9,
          transactionTimestamp: "2023-02-02",
        });
        await addAndIngest(client, [s1, s2]);
        expect(
          await aggregateSalesByProject({
            client,
            afterDate: new Date("2023-01-01"),
          })
        ).toEqual([{ projectId: archetypeId, totalEthSales: "500" }]);
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
          tokenSpec: snapshots.THE_CUBE,
          price: "1000",
        });
        const s2 = sale({
          id: "2",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "500",
        });
        const s3 = sale({
          id: "3",
          tokenSpec: snapshots.PERFECT_CHROMATIC,
          price: "99",
        });
        await addAndIngest(client, [s1, s2, s3]);
        expect(await aggregateSalesByProject({ client })).toEqual([
          { projectId: archetypeId, totalEthSales: "1500" },
          { projectId: squigglesId, totalEthSales: "99" },
        ]);
      })
    );
  });

  describe("lastSalesByProject", () => {
    it(
      "returns empty array if there are no sales for the project",
      withTestDb(async ({ client }) => {
        const { archetypeId } = await exampleProjectAndToken({ client });
        expect(
          await lastSalesByProject({
            client,
            projectId: archetypeId,
          })
        ).toEqual([]);
      })
    );
    it(
      "finds latest ETH/WETH sale for each token",
      withTestDb(async ({ client }) => {
        const { archetypeId, archetypeTokenId1, archetypeTokenId2 } =
          await exampleProjectAndToken({ client });
        const s1 = sale({
          id: "1",
          tokenSpec: snapshots.THE_CUBE,
          price: "1000",
          transactionTimestamp: dateToOpenseaString(new Date("2023-01-01")),
          currency: wellKnownCurrencies.eth,
        });
        const s2 = sale({
          id: "2",
          tokenSpec: snapshots.THE_CUBE,
          price: "1200",
          transactionTimestamp: dateToOpenseaString(new Date("2023-01-02")),
          currency: wellKnownCurrencies.weth9,
        });
        const s3 = sale({
          id: "3",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "800",
          transactionTimestamp: dateToOpenseaString(new Date("2023-01-03")),
          currency: wellKnownCurrencies.eth,
        });
        // Irrelevant sale (wrong currency).
        const s4 = sale({
          id: "4",
          tokenSpec: snapshots.ARCH_TRIPTYCH_1,
          price: "11111",
          transactionTimestamp: dateToOpenseaString(new Date("2023-01-04")),
          currency: wellKnownCurrencies.usdc, // sale will be ignored
        });
        // Irrelevant sale (wrong currency). This token has no relevant sales.
        const s5 = sale({
          id: "5",
          tokenSpec: snapshots.ARCH_TRIPTYCH_2,
          price: "22222",
          transactionTimestamp: dateToOpenseaString(new Date("2023-01-05")),
          currency: wellKnownCurrencies.usdc,
        });
        // Irrelevant sale (wrong project).
        const s6 = sale({
          id: "6",
          tokenSpec: snapshots.PERFECT_CHROMATIC,
          price: "75837583",
          transactionTimestamp: dateToOpenseaString(new Date("2023-01-06")),
          currency: wellKnownCurrencies.eth,
        });
        await addAndIngest(client, [s1, s2, s3, s4, s5]);
        expect(
          await lastSalesByProject({
            client,
            projectId: archetypeId,
          })
        ).toEqual([
          {
            tokenId: archetypeTokenId1,
            saleTime: new Date("2023-01-02"),
            priceWei: "1200",
          },
          {
            tokenId: archetypeTokenId2,
            saleTime: new Date("2023-01-03"),
            priceWei: "800",
          },
        ]);
      })
    );
  });
  describe("lookup for OS listing imports", () => {
    it(
      "reports the best OS ask with no archipelago ask",
      withTestDb(async ({ client }) => {
        const { archetypeTokenId1 } = await exampleProjectAndToken({ client });
        await eth.addBlock({ client, block: genesis() });
        const t = transfer({ tokenId: archetypeTokenId1, to: ijd });
        await eth.addErc721Transfers({ client, transfers: [t] });
        const a1 = ask({
          id: "1",
          tokenId: snapshots.THE_CUBE,
          sellerAddress: ijd,
          price: "5000",
          listingTime: dateToOpenseaString(new Date("2022-01-01")),
        });
        const a2 = ask({
          id: "2",
          tokenId: snapshots.THE_CUBE,
          sellerAddress: ijd,
          price: "100",
          listingTime: dateToOpenseaString(new Date("2022-02-02")),
        });
        await addAndIngest(client, [a1, a2]);
        const res = await unlistedOpenseaAsks({ client, address: ijd });
        expect(res).toEqual([
          {
            askId: "opensea:2",
            tokenId: expect.any(String),
            price: "100",
            name: "Archetype",
            slug: "archetype",
            tokenIndex: 250,
            tokenContract: "0xa7d8d9ef8D8Ce8992Df33D8b8CF4Aebabd5bD270",
            onChainTokenId: "23000250",
            deadline: null,
          },
        ]);
      })
    );
  });
});
