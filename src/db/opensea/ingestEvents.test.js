const ethers = require("ethers");

const { acqrel, bufToHex, hexToBuf } = require("../util");
const adHocPromise = require("../../util/adHocPromise");
const {
  websocketMessagesChannel,
  addRawEvents,
  ingestEvents,
} = require("./ingestEvents");
const artblocks = require("../artblocks");
const channels = require("../channels");
const { testDbProvider } = require("../testUtil");
const snapshots = require("../../scrape/snapshots");
const { parseProjectData } = require("../../scrape/fetchArtblocksProject");
const wellKnownCurrencies = require("../wellKnownCurrencies");

describe("db/opensea/ingestEvents", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addAndIngest(client, events) {
    await addRawEvents({ client, events });
    return await ingestEvents({ client });
  }

  function utcDateFromString(x) {
    return new Date(x + "Z");
  }

  const dandelion = "0xe03a5189dac8182085e4adf66281f679fff2291d";
  const wchargin = "0xefa7bdd92b5e9cd9de9b54ac0e3dc60623f1c989";

  function sale({
    id = "2",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    listingTime = "2022-03-01T00:00:00.123456",
    toAddress = dandelion,
    fromAddress = wchargin,
    totalPrice = "1000000000000000000",
    transactionTimestamp = "2022-03-03T12:34:56.123456",
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
      total_price: totalPrice,
      payment_token: paymentTokenForCurrency(currency),
      event_type: "successful",
    };
  }
  async function getSale(client, id) {
    const res = await client.query(
      `
          SELECT
            event_id AS "id",
            project_id AS "projectId",
            token_id AS "tokenId",
            seller_address AS "sellerAddress",
            buyer_address AS "buyerAddress",
            transaction_timestamp AS "transactionTimestamp",
            transaction_hash AS "transactionHash",
            listing_time AS "listingTime",
            price,
            currency_id AS "currencyId"
          FROM opensea_sales
          WHERE event_id = $1
          `,
      [id]
    );
    if (res.rows.length == 0) {
      return null;
    }
    const x = res.rows[0];
    return {
      ...x,
      sellerAddress: bufToHex(x.sellerAddress),
      buyerAddress: bufToHex(x.buyerAddress),
    };
  }

  function ask({
    id = "3",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    listingTime = "2022-03-01T00:00:00",
    duration = null,
    sellerAddress = wchargin,
    startingPrice = "1000000000000000000",
    auctionType = "dutch",
    isPrivate = false,
    currency = wellKnownCurrencies.eth,
  } = {}) {
    return {
      asset: { address, token_id: String(tokenId) },
      id,
      seller: { address: sellerAddress },
      listing_time: listingTime,
      duration,
      starting_price: startingPrice,
      auction_type: auctionType,
      payment_token: paymentTokenForCurrency(currency),
      event_type: "created",
      is_private: isPrivate,
    };
  }
  async function getAsk(client, id) {
    const res = await client.query(
      `
          SELECT
            event_id AS "id",
            project_id AS "projectId",
            token_id AS "tokenId",
            seller_address AS "sellerAddress",
            listing_time AS "listingTime",
            expiration_time AS "expirationTime",
            price,
            currency_id AS "currencyId",
            active
          FROM opensea_asks
          WHERE event_id = $1
          `,
      [id]
    );
    if (res.rows.length == 0) {
      return null;
    }
    const x = res.rows[0];
    return {
      ...x,
      sellerAddress: bufToHex(x.sellerAddress),
    };
  }

  function cancellation({
    id = "4",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    price = "1000000000000000000",
    transactionTimestamp = "2022-03-03T12:34:56.123456",
    transactionHash = "0xef7e95ce1c085611cb5186a55cec026cd3f2f266c1f581bb6a9e9258cf3019f4",
  } = {}) {
    return {
      asset: { address, token_id: String(tokenId) },
      id,
      listing_time: null,
      total_price: price,
      transaction: {
        timestamp: transactionTimestamp,
        transaction_hash: transactionHash,
      },
      event_type: "cancelled",
    };
  }
  async function getCancellation(client, id) {
    const res = await client.query(
      `
          SELECT
            event_id AS "id",
            project_id AS "projectId",
            token_id AS "tokenId",
            transaction_timestamp AS "transactionTimestamp",
            transaction_hash AS "transactionHash",
            price
          FROM opensea_ask_cancellations
          WHERE event_id = $1
          `,
      [id]
    );
    if (res.rows.length == 0) {
      return null;
    }
    const x = res.rows[0];
    return x;
  }

  async function exampleProjectAndToken({ client }) {
    const project = parseProjectData(
      snapshots.ARCHETYPE,
      await sc.project(snapshots.ARCHETYPE)
    );
    const token = await sc.token(snapshots.THE_CUBE);
    const projectId = await artblocks.addProject({
      client,
      project,
    });
    const tokenId = await artblocks.addToken({
      client,
      artblocksTokenId: snapshots.THE_CUBE,
      rawTokenData: token,
    });
    return { project, token, projectId, tokenId };
  }

  function paymentTokenForCurrency(currency) {
    return {
      name: currency.name,
      symbol: currency.symbol,
      address: currency.address,
      decimals: currency.decimals,
    };
  }

  async function unconsumedIds(client) {
    const res = await client.query(`
      SELECT event_id from opensea_events_ingestion_queue
      `);
    return res.rows.map((x) => x.event_id);
  }

  async function deferredIds(client) {
    const res = await client.query(`
      SELECT event_id from opensea_events_ingestion_deferred
      `);
    return res.rows.map((x) => x.event_id);
  }

  describe("raw events and queue", () => {
    it(
      "raw events may be added",
      withTestDb(async ({ client }) => {
        const ev = ask();
        const numAdded = await addRawEvents({ client, events: [ev] });
        expect(numAdded).toEqual(1);
        const res = await client.query(`
        SELECT * FROM opensea_events_raw
        `);
        expect(res.rows).toEqual([{ event_id: ev.id, json: ev }]);
        expect(await unconsumedIds(client)).toEqual([ev.id]);
      })
    );

    it(
      "if event is added while already in queue, it will not be duplicated in queue",
      withTestDb(async ({ client }) => {
        const ev = ask();
        let numAdded = await addRawEvents({ client, events: [ev] });
        expect(numAdded).toEqual(1);
        numAdded = await addRawEvents({ client, events: [ev] });
        expect(numAdded).toEqual(0);
        expect(await unconsumedIds(client)).toEqual([ev.id]);
      })
    );

    it(
      "if event is added that was already processed from queue, it will not be added back to queue",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = ask();
        let numAdded = await addRawEvents({ client, events: [ev] });
        expect(numAdded).toEqual(1);
        await ingestEvents({ client });
        expect(await unconsumedIds(client)).toEqual([]);
        numAdded = await addRawEvents({ client, events: [ev] });
        expect(numAdded).toEqual(0);
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );
  });

  describe("event filtering", () => {
    it(
      "filters out invalid transactions, and removes from queue",
      withTestDb(async ({ client }) => {
        const events = [
          sale({ id: "3", transactionTimestamp: null }),
          sale({ id: "4", transactionHash: null }),
          cancellation({ id: "5", transactionTimestamp: null }),
          cancellation({ id: "6", transactionHash: null }),
        ];
        await addAndIngest(client, events);
        expect(await getSale(client, "3")).toEqual(null);
        expect(await getSale(client, "4")).toEqual(null);
        expect(await getCancellation(client, "5")).toEqual(null);
        expect(await getCancellation(client, "6")).toEqual(null);
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );

    it(
      "filters out non-dutch asks, and removes from queue",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const events = [
          ask({ id: "1", auctionType: "dutch" }),
          ask({ id: "2", auctionType: "english" }),
          ask({ id: "3", auctionType: "japanese" }),
        ];
        await addAndIngest(client, events);
        expect(await getAsk(client, "1")).not.toEqual(null);
        expect(await getAsk(client, "2")).toEqual(null);
        expect(await getAsk(client, "3")).toEqual(null);
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );
    it(
      "filters out private asks, and removes from queue",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const events = [ask({ id: "1" }), ask({ id: "2", isPrivate: true })];
        await addAndIngest(client, events);
        expect(await getAsk(client, "1")).not.toEqual(null);
        expect(await getAsk(client, "2")).toEqual(null);
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );
  });

  describe("deferred ingestion", () => {
    it(
      "will add events without a project id to the deferred ingestion queue",
      withTestDb(async ({ client }) => {
        const ev1 = ask({ id: "1" });
        const ev2 = cancellation({ id: "2" });
        const ev3 = sale({ id: "3" });
        await addAndIngest(client, [ev1, ev2, ev3]);
        expect(await getAsk(client, "1")).toEqual(null);
        expect(await getCancellation(client, "2")).toEqual(null);
        expect(await getSale(client, "3")).toEqual(null);
        // Events were moved from ingestion queue, and moved to ingestion deferred
        expect(await deferredIds(client)).toEqual(["1", "2", "3"]);
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );
    it(
      "will ingest deferred events when possible",
      withTestDb(async ({ client }) => {
        const ev1 = ask({ id: "1" });
        const ev2 = cancellation({ id: "2" });
        const ev3 = sale({ id: "3" });
        await addAndIngest(client, [ev1, ev2, ev3]);
        expect(await getAsk(client, "1")).toEqual(null);
        expect(await getCancellation(client, "2")).toEqual(null);
        expect(await getSale(client, "3")).toEqual(null);
        // Events were moved from ingestion queue, and moved to ingestion deferred
        expect(await deferredIds(client)).toEqual(["1", "2", "3"]);
        expect(await unconsumedIds(client)).toEqual([]);

        // now we add the tokens, enabling deferred ingestion
        await exampleProjectAndToken({ client });
        await addAndIngest(client, [ev1, ev2, ev3]);
        expect(await deferredIds(client)).toEqual([]);
        expect(await unconsumedIds(client)).toEqual([]);
        expect(await getAsk(client, "1")).not.toEqual(null);
        expect(await getCancellation(client, "2")).not.toEqual(null);
        expect(await getSale(client, "3")).not.toEqual(null);
      })
    );
  });

  describe("regular event ingestion", () => {
    it(
      "will ingest a sale",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = sale();
        await addAndIngest(client, [ev]);
        expect(await getSale(client, ev.id)).toEqual({
          id: ev.id,
          projectId,
          tokenId,
          sellerAddress: ev.seller.address,
          buyerAddress: ev.winner_account.address,
          transactionTimestamp: utcDateFromString(ev.transaction.timestamp),
          transactionHash: ev.transaction.transaction_hash,
          listingTime: utcDateFromString(ev.listing_time),
          price: ev.total_price,
          currencyId: wellKnownCurrencies.eth.currencyId,
        });
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );

    it(
      "handles a sale with null listing_time",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = sale({ listingTime: null });
        await addAndIngest(client, [ev]);
        expect(await getSale(client, ev.id)).toEqual({
          id: ev.id,
          projectId,
          tokenId,
          sellerAddress: ev.seller.address,
          buyerAddress: ev.winner_account.address,
          transactionTimestamp: utcDateFromString(ev.transaction.timestamp),
          transactionHash: ev.transaction.transaction_hash,
          listingTime: null,
          price: ev.total_price,
          currencyId: wellKnownCurrencies.eth.currencyId,
        });
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );

    it(
      "will ingest an ask cancellation",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = cancellation();
        await addAndIngest(client, [ev]);
        expect(await getCancellation(client, ev.id)).toEqual({
          id: ev.id,
          projectId,
          tokenId,
          price: ev.total_price,
          transactionTimestamp: utcDateFromString(ev.transaction.timestamp),
          transactionHash: ev.transaction.transaction_hash,
        });
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );

    it(
      "will ingest an ask",
      withTestDb(async ({ pool, client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = ask();
        await acqrel(pool, async (listenClient) => {
          const postgresEvent = adHocPromise();
          listenClient.on("notification", (n) => {
            if (n.channel === websocketMessagesChannel.name) {
              postgresEvent.resolve(n.payload);
            } else {
              postgresEvent.reject("unexpected channel: " + n.channel);
            }
          });
          await websocketMessagesChannel.listen(listenClient);

          await addAndIngest(client, [ev]);
          expect(await getAsk(client, ev.id)).toEqual({
            id: ev.id,
            projectId,
            tokenId,
            listingTime: utcDateFromString(ev.listing_time),
            sellerAddress: ev.seller.address,
            price: ev.starting_price,
            currencyId: wellKnownCurrencies.eth.currencyId,
            expirationTime: null,
            active: true,
          });
          const eventValue = await postgresEvent.promise;
          expect(JSON.parse(eventValue)).toEqual({
            type: "ASK_PLACED",
            orderId: "opensea:" + String(ev.id),
            projectId,
            tokenId,
            slug: "archetype",
            tokenIndex: 250,
            venue: "OPENSEA",
            seller: ethers.utils.getAddress(wchargin),
            currency: "ETH",
            price: ev.starting_price,
            timestamp: "2022-03-01T00:00:00.000Z",
            expirationTime: null,
          });
          expect(await unconsumedIds(client)).toEqual([]);
        });
      })
    );

    it(
      "computes ask expiration timestamps correctly",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const ev = ask({ duration: 77 });
        await addAndIngest(client, [ev]);
        const theAsk = await getAsk(client, ev.id);
        const expectedExpiration = new Date(+theAsk.listingTime + 77 * 1000);
        expect(theAsk.expirationTime).toEqual(expectedExpiration);
      })
    );
  });

  describe("ask<->cancellation interactions", () => {
    it(
      "cancelled asks are not active (ask first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a1 = ask({
          id: "1",
          startingPrice: "1000",
          listingTime: "2022-03-01",
        });
        const a2 = ask({
          id: "2",
          startingPrice: "2000",
          listingTime: "2022-03-01",
        });
        const c3 = cancellation({
          id: "3",
          price: "1000",
          transactionTimestamp: "2022-04-01",
        });
        const c4 = cancellation({
          id: "4",
          price: "2000",
          transactionTimestamp: "2020-03-03",
        });
        await addAndIngest(client, [a1, a2]);
        expect((await getAsk(client, "1")).active).toBe(true);
        expect((await getAsk(client, "2")).active).toBe(true);
        await addAndIngest(client, [c3, c4]);
        expect((await getAsk(client, "1")).active).toBe(false);
        // ask 2 is still active, because the cancellation's transaction timestamp is too early.
        expect((await getAsk(client, "2")).active).toBe(true);
      })
    );
    it(
      "cancelled asks are not active (cancellation first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a1 = ask({
          id: "1",
          startingPrice: "1000",
          listingTime: "2022-03-01",
        });
        const a2 = ask({
          id: "2",
          startingPrice: "2000",
          listingTime: "2022-03-01",
        });
        const c3 = cancellation({
          id: "3",
          price: "1000",
          transactionTimestamp: "2022-04-01",
        });
        const c4 = cancellation({
          id: "4",
          price: "2000",
          transactionTimestamp: "2020-03-03",
        });
        await addAndIngest(client, [c3, c4]);
        await addAndIngest(client, [a1, a2]);
        expect((await getAsk(client, "1")).active).toBe(false);
        // ask 2 is still active, because the cancellation's transaction timestamp is too early.
        expect((await getAsk(client, "2")).active).toBe(true);
      })
    );
    it(
      "can mark multiple asks as cancelled from one cancellation",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const c = cancellation({ id: "0" });
        const ax = (x) =>
          ask({
            id: x,
          });
        await addAndIngest(client, [ax("1"), ax("2")]);
        await addAndIngest(client, [c]);
        await addAndIngest(client, [ax("3"), ax("4")]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(false);
        expect((await getAsk(client, "3")).active).toBe(false);
        expect((await getAsk(client, "4")).active).toBe(false);
      })
    );
    it(
      "asks from before 2022-02-01 are auto cancelled",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a1 = ask({
          id: "1",
          startingPrice: "1000",
          listingTime: "2022-01-01",
        });
        const a2 = ask({
          id: "2",
          startingPrice: "2000",
          listingTime: "2022-03-01",
        });
        await addAndIngest(client, [a1, a2]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(true);
      })
    );
  });

  describe("ask<->sale interactions", () => {
    const listingTime = "2022-03-01T00:00:00.123456";
    it(
      "successful asks are not active (ask first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", listingTime });
        const s = sale({ id: "2", listingTime });
        await addAndIngest(client, [a]);
        expect((await getAsk(client, "1")).active).toBe(true);
        await addAndIngest(client, [s]);
        expect((await getAsk(client, "1")).active).toBe(false);
      })
    );
    it(
      "successful asks are not active (sale first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", listingTime });
        const s = sale({ id: "2", listingTime });
        await addAndIngest(client, [s]);
        await addAndIngest(client, [a]);
        expect((await getAsk(client, "1")).active).toBe(false);
      })
    );
    it(
      "can mark multiple asks as cancelled from one sale",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const s = sale({ id: "0", listingTime });
        const ax = (x) =>
          ask({
            id: x,
            listingTime,
          });
        await addAndIngest(client, [ax("1"), ax("2")]);
        await addAndIngest(client, [s]);
        await addAndIngest(client, [ax("3"), ax("4")]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(false);
        expect((await getAsk(client, "3")).active).toBe(false);
        expect((await getAsk(client, "4")).active).toBe(false);
      })
    );
    it(
      "a sale cancels all older asks (asks ingested first)",
      withTestDb(async ({ client }) => {
        const a1 = ask({ id: "1", listingTime: "2023-01-01" });
        const a2 = ask({ id: "2", listingTime: "2023-01-02" });
        const a3 = ask({ id: "3", listingTime: "2023-01-03" });
        const s = sale({ id: "4", transactionTimestamp: "2023-01-02" });
        const { projectId } = await exampleProjectAndToken({ client });
        await addAndIngest(client, [a1, a2, a3]);
        await addAndIngest(client, [s]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(false);
        expect((await getAsk(client, "3")).active).toBe(true);
      })
    );
    it(
      "a sale cancels all older asks (sale ingested first)",
      withTestDb(async ({ client }) => {
        const a1 = ask({ id: "1", listingTime: "2023-01-01" });
        const a2 = ask({ id: "2", listingTime: "2023-01-02" });
        const a3 = ask({ id: "3", listingTime: "2023-01-03" });
        const s = sale({ id: "4", transactionTimestamp: "2023-01-02" });
        const { projectId } = await exampleProjectAndToken({ client });
        await addAndIngest(client, [s]);
        await addAndIngest(client, [a1, a2, a3]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(false);
        expect((await getAsk(client, "3")).active).toBe(true);
      })
    );
  });

  describe("currency discovery", () => {
    const c1 = {
      address: "0x2222222222222222222222222222222222222222",
      symbol: "NEW",
      name: "New Currency",
      decimals: 18,
    };
    const c2 = {
      address: "0x2222222222222222222222222222222222222223",
      symbol: "NEW",
      name: "New Currency",
      decimals: 18,
    };

    async function numCurrencies(client) {
      const res = await client.query("SELECT 1 FROM currencies");
      return res.rows.length;
    }

    async function getCurrency(client, address) {
      const res = await client.query(
        `
          SELECT currency_id AS "currencyId", address, symbol, name, decimals
          FROM currencies
          WHERE address = $1
          `,
        [hexToBuf(address)]
      );
      if (res.rows.length === 0) {
        return null;
      }
      const x = res.rows[0];
      return { ...x, address: bufToHex(x.address) };
    }

    it(
      "does not add already-known currencies",
      withTestDb(async ({ client }) => {
        await exampleProjectAndToken({ client });
        const ev = sale();
        await addAndIngest(client, [ev]);
        expect(await numCurrencies(client)).toEqual(
          wellKnownCurrencies.currencies.length
        );
      })
    );

    it(
      "adds new currencies from sales and asks",
      withTestDb(async ({ client }) => {
        await exampleProjectAndToken({ client });
        const ev1 = sale({ id: "1", currency: c1 });
        const ev2 = ask({ id: "2", currency: c2 });
        await addAndIngest(client, [ev1, ev2]);
        const cur1 = await getCurrency(client, c1.address);
        const cur2 = await getCurrency(client, c2.address);
        expect({ ...cur1, currencyId: undefined }).toEqual(c1);
        expect({ ...cur2, currencyId: undefined }).toEqual(c2);
        expect(await numCurrencies(client)).toEqual(
          wellKnownCurrencies.currencies.length + 2
        );
        const theSale = await getSale(client, "1");
        expect(theSale.currencyId).toEqual(cur1.currencyId);
        const theAsk = await getAsk(client, "2");
        expect(theAsk.currencyId).toEqual(cur2.currencyId);
      })
    );
    it(
      "will not replace currencies, even on conflicting data",
      withTestDb(async ({ client }) => {
        await exampleProjectAndToken({ client });
        const eth = wellKnownCurrencies.eth;
        const conflictingEth = { ...eth, symbol: "GAS" };
        const ev1 = sale({ currency: conflictingEth });
        await addAndIngest(client, [ev1]);
        const expected = { ...eth };
        expect(await getCurrency(client, eth.address)).toEqual(expected);
      })
    );
  });

  it(
    "will mark expired asks as not active",
    withTestDb(async ({ client }) => {
      const listingTime = "2022-03-01T00:00:00.123456";
      const year = 365 * 24 * 60 * 60;
      await exampleProjectAndToken({ client });
      const a1 = ask({ id: "1", listingTime, duration: 1 });
      const a2 = ask({ id: "2", listingTime, duration: null });
      const a3 = ask({ id: "3", listingTime, duration: year * 100 });
      await addAndIngest(client, [a1, a2, a3]);
      const getActive = async (x) => (await getAsk(client, x)).active;
      expect(await getActive("1")).toBe(false);
      expect(await getActive("2")).toBe(true);
      expect(await getActive("3")).toBe(true);
    })
  );

  it(
    "handles events with null payment token",
    withTestDb(async ({ client }) => {
      // We got this event from OpenSea. It doesn't seem to make sense---e.g.,
      // the asset address is an externally owned account, not a contract---and
      // OpenSea won't return it on subsequent calls. But, we still shouldn't
      // crash on it.
      const event = {
        id: 3249279049,
        asset: {
          address: "0x2953399124f0cbb46d2cbacd8a89cf0599974963",
          token_id:
            "33045074806130434421210947411507583564092974799725809586528142502404611375105",
        },
        seller: {
          user: null,
          config: "",
          address: "0x490ed97b354fd7e100399df05a46bf339176ddfa",
          profile_img_url:
            "https://storage.googleapis.com/opensea-static/opensea-profile/10.png",
        },
        duration: "604800",
        quantity: "1",
        bid_amount: null,
        event_type: "created",
        is_private: false,
        to_account: null,
        total_price: null,
        transaction: null,
        asset_bundle: null,
        auction_type: null,
        created_date: "2022-02-03T23:14:48.844868",
        ending_price: "9200000000000000",
        from_account: {
          user: null,
          config: "",
          address: "0x490ed97b354fd7e100399df05a46bf339176ddfa",
          profile_img_url:
            "https://storage.googleapis.com/opensea-static/opensea-profile/10.png",
        },
        listing_time: "2022-02-03T23:14:35",
        owner_account: null,
        payment_token: null,
        starting_price: "9200000000000000",
        winner_account: null,
        collection_slug: "affluent-of-nfts",
        approved_account: null,
        contract_address: "",
        custom_event_name: null,
        dev_fee_payment_event: null,
        dev_seller_fee_basis_points: null,
      };
      await addAndIngest(client, [event]);
      // The current behavior is that the event gets implicitly deferred
      // because it doesn't match a known currency (since none is added).
      const deferredCountRes = await client.query(
        `
        SELECT count(1) AS n FROM opensea_events_ingestion_deferred
        WHERE event_id = $1
        `,
        [event.id]
      );
      expect(deferredCountRes.rows).toEqual([{ n: "1" }]);
    })
  );

  it(
    "paginates as needed",
    withTestDb(async ({ client }) => {
      const ev1 = ask({ id: "1" });
      const ev2 = ask({ id: "2" });
      const ev3 = cancellation({ id: "3" });
      const ev4 = sale({ id: "4" });
      const events = [ev1, ev2, ev3, ev4];
      await addRawEvents({ client, events });
      await ingestEvents({ client, perPage: 1 });
      expect(await unconsumedIds(client)).toEqual([]);
    })
  );
});
