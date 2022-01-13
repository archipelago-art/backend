const { bufToHex, hexToBuf } = require("../util");
const {
  addRawEvents,
  ingestEvents,
  deactivateExpiredAsks,
} = require("./ingestEvents");
const artblocks = require("../artblocks");
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

  function transfer({
    id = "1",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    toAddress = dandelion,
    fromAddress = wchargin,
    transactionTimestamp = "2021-03-03T12:34:56.123456",
    transactionHash = "0xef7e95ce1c085611cb5186a55cec026cd3f2f266c1f581bb6a9e9258cf3019f4",
  } = {}) {
    return {
      asset: { address, token_id: String(tokenId) },
      id,
      to_account: { address: toAddress },
      from_account: { address: fromAddress },
      transaction: {
        timestamp: transactionTimestamp,
        transaction_hash: transactionHash,
      },
      event_type: "transfer",
    };
  }
  async function getTransfer(client, id) {
    const res = await client.query(
      `
          SELECT
            event_id AS "id",
            project_id AS "projectId",
            token_id AS "tokenId",
            to_address AS "toAddress",
            from_address AS "fromAddress",
            transaction_timestamp AS "transactionTimestamp",
            transaction_hash AS "transactionHash",
            redundant
          FROM opensea_transfers
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
      toAddress: bufToHex(x.toAddress),
      fromAddress: bufToHex(x.fromAddress),
    };
  }

  function sale({
    id = "2",
    address = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    listingTime = "2021-03-01T00:00:00.123456",
    toAddress = dandelion,
    fromAddress = wchargin,
    totalPrice = "1000000000000000000",
    transactionTimestamp = "2021-03-03T12:34:56.123456",
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
    listingTime = "2021-03-01T00:00:00",
    duration = null,
    sellerAddress = wchargin,
    startingPrice = "1000000000000000000",
    auctionType = "dutch",
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
    listingTime = "2021-03-01T00:00:00",
    transactionTimestamp = "2021-03-03T12:34:56.123456",
    transactionHash = "0xef7e95ce1c085611cb5186a55cec026cd3f2f266c1f581bb6a9e9258cf3019f4",
  } = {}) {
    return {
      asset: { address, token_id: String(tokenId) },
      id,
      listing_time: listingTime,
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
            listing_time AS "listingTime"
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
        const ev = transfer();
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
        const ev = transfer();
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
        const ev = transfer();
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
          transfer({ id: "1", transactionTimestamp: null }),
          transfer({ id: "2", transactionHash: null }),
          sale({ id: "3", transactionTimestamp: null }),
          sale({ id: "4", transactionHash: null }),
          cancellation({ id: "5", transactionTimestamp: null }),
          cancellation({ id: "6", transactionHash: null }),
        ];
        await addAndIngest(client, events);
        expect(await getTransfer(client, "1")).toEqual(null);
        expect(await getTransfer(client, "2")).toEqual(null);
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
  });

  describe("deferred ingestion", () => {
    it(
      "will add events without a project id to the deferred ingestion queue",
      withTestDb(async ({ client }) => {
        const ev1 = transfer({ id: "1" });
        const ev2 = ask({ id: "2" });
        const ev3 = cancellation({ id: "3" });
        const ev4 = sale({ id: "4" });
        await addAndIngest(client, [ev1, ev2, ev3, ev4]);
        expect(await getTransfer(client, "1")).toEqual(null);
        expect(await getAsk(client, "2")).toEqual(null);
        expect(await getCancellation(client, "3")).toEqual(null);
        expect(await getSale(client, "4")).toEqual(null);
        // Events were moved from ingestion queue, and moved to ingestion deferred
        expect(await deferredIds(client)).toEqual(["1", "2", "3", "4"]);
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );
    it(
      "will ingest deferred events when possible",
      withTestDb(async ({ client }) => {
        const ev1 = transfer({ id: "1" });
        const ev2 = ask({ id: "2" });
        const ev3 = cancellation({ id: "3" });
        const ev4 = sale({ id: "4" });
        await addAndIngest(client, [ev1, ev2, ev3, ev4]);
        expect(await getTransfer(client, "1")).toEqual(null);
        expect(await getAsk(client, "2")).toEqual(null);
        expect(await getCancellation(client, "3")).toEqual(null);
        expect(await getSale(client, "4")).toEqual(null);
        // Events were moved from ingestion queue, and moved to ingestion deferred
        expect(await deferredIds(client)).toEqual(["1", "2", "3", "4"]);
        expect(await unconsumedIds(client)).toEqual([]);

        // now we add the tokens, enabling deferred ingestion
        await exampleProjectAndToken({ client });
        await addAndIngest(client, [ev1, ev2, ev3, ev4]);
        expect(await deferredIds(client)).toEqual([]);
        expect(await unconsumedIds(client)).toEqual([]);
        expect(await getTransfer(client, "1")).not.toEqual(null);
        expect(await getAsk(client, "2")).not.toEqual(null);
        expect(await getCancellation(client, "3")).not.toEqual(null);
        expect(await getSale(client, "4")).not.toEqual(null);
      })
    );
  });

  describe("regular event ingestion", () => {
    it(
      "will ingest a transfer",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = transfer();
        await addAndIngest(client, [ev]);
        expect(await getTransfer(client, ev.id)).toEqual({
          id: ev.id,
          projectId,
          tokenId,
          toAddress: ev.to_account.address,
          fromAddress: ev.from_account.address,
          transactionTimestamp: utcDateFromString(ev.transaction.timestamp),
          transactionHash: ev.transaction.transaction_hash,
          redundant: false,
        });
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );

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
          listingTime: utcDateFromString(ev.listing_time),
          transactionTimestamp: utcDateFromString(ev.transaction.timestamp),
          transactionHash: ev.transaction.transaction_hash,
        });
        expect(await unconsumedIds(client)).toEqual([]);
      })
    );

    it(
      "will ingest an ask",
      withTestDb(async ({ client }) => {
        const { projectId, tokenId } = await exampleProjectAndToken({ client });
        const ev = ask();
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
        expect(await unconsumedIds(client)).toEqual([]);
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

  describe("transfer<->sale interactions", () => {
    it(
      "marks transfers as redundant (transfer first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const s = sale({ id: "1" });
        const t = transfer({
          id: "2",
          transactionTimestamp: s.transactionTimestamp,
          transactionHash: s.transactionHash,
        });
        await addAndIngest(client, [t]);
        await addAndIngest(client, [s]);
        const res = await getTransfer(client, "2");
        expect(res.redundant).toBe(true);
      })
    );
    it(
      "marks transfers as redundant (sale first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const s = sale({ id: "1" });
        const t = transfer({
          id: "2",
          transactionTimestamp: s.transactionTimestamp,
          transactionHash: s.transactionHash,
        });
        await addAndIngest(client, [s]);
        await addAndIngest(client, [t]);
        const res = await getTransfer(client, "2");
        expect(res.redundant).toBe(true);
      })
    );
    it(
      "can mark multiple transfers as redundant from one sale",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const s = sale({ id: "0" });
        const tx = (x) =>
          transfer({
            id: x,
            transactionTimestamp: s.transactionTimestamp,
            transactionHash: s.transactionHash,
          });
        await addAndIngest(client, [tx("1"), tx("2")]);
        await addAndIngest(client, [s]);
        await addAndIngest(client, [tx("3"), tx("4")]);
        expect((await getTransfer(client, "1")).redundant).toBe(true);
        expect((await getTransfer(client, "2")).redundant).toBe(true);
        expect((await getTransfer(client, "3")).redundant).toBe(true);
        expect((await getTransfer(client, "4")).redundant).toBe(true);
      })
    );
  });

  describe("ask<->cancellation interactions", () => {
    const listingTime = "2021-03-01T00:00:00.123456";
    it(
      "cancelled asks are not active (ask first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", listingTime });
        const c = cancellation({ id: "2", listingTime });
        await addAndIngest(client, [a]);
        expect((await getAsk(client, "1")).active).toBe(true);
        await addAndIngest(client, [c]);
        expect((await getAsk(client, "1")).active).toBe(false);
      })
    );
    it(
      "cancelled asks are not active (cancellation first)",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const a = ask({ id: "1", listingTime });
        const c = cancellation({ id: "2", listingTime });
        await addAndIngest(client, [c]);
        await addAndIngest(client, [a]);
        expect((await getAsk(client, "1")).active).toBe(false);
      })
    );
    it(
      "can mark multiple asks as cancelled from one cancellation",
      withTestDb(async ({ client }) => {
        const { projectId } = await exampleProjectAndToken({ client });
        const c = cancellation({ id: "0", listingTime });
        const ax = (x) =>
          ask({
            id: x,
            listingTime,
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
  });

  describe("ask<->sale interactions", () => {
    const listingTime = "2021-03-01T00:00:00.123456";
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
        const a1 = ask({ id: "1", listingTime: "2020-01-01" });
        const a2 = ask({ id: "2", listingTime: "2020-01-02" });
        const a3 = ask({ id: "3", listingTime: "2020-01-03" });
        const s = sale({ id: "4", transactionTimestamp: "2020-01-02" });
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
        const a1 = ask({ id: "1", listingTime: "2020-01-01" });
        const a2 = ask({ id: "2", listingTime: "2020-01-02" });
        const a3 = ask({ id: "3", listingTime: "2020-01-03" });
        const s = sale({ id: "4", transactionTimestamp: "2020-01-02" });
        const { projectId } = await exampleProjectAndToken({ client });
        await addAndIngest(client, [s]);
        await addAndIngest(client, [a1, a2, a3]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(false);
        expect((await getAsk(client, "3")).active).toBe(true);
      })
    );
  });

  describe("ask<->transfer interactions", () => {
    it(
      "a transfer cancels all older asks (asks ingested first)",
      withTestDb(async ({ client }) => {
        const a1 = ask({ id: "1", listingTime: "2020-01-01" });
        const a2 = ask({ id: "2", listingTime: "2020-01-02" });
        const a3 = ask({ id: "3", listingTime: "2020-01-03" });
        const s = transfer({ id: "4", transactionTimestamp: "2020-01-02" });
        const { projectId } = await exampleProjectAndToken({ client });
        await addAndIngest(client, [a1, a2, a3]);
        await addAndIngest(client, [s]);
        expect((await getAsk(client, "1")).active).toBe(false);
        expect((await getAsk(client, "2")).active).toBe(false);
        expect((await getAsk(client, "3")).active).toBe(true);
      })
    );
    it(
      "a transfer cancels all older asks (transfer ingested first)",
      withTestDb(async ({ client }) => {
        const a1 = ask({ id: "1", listingTime: "2020-01-01" });
        const a2 = ask({ id: "2", listingTime: "2020-01-02" });
        const a3 = ask({ id: "3", listingTime: "2020-01-03" });
        const s = transfer({ id: "4", transactionTimestamp: "2020-01-02" });
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
      const listingTime = "2021-03-01T00:00:00.123456";
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
    "paginates as needed",
    withTestDb(async ({ client }) => {
      const ev1 = transfer({ id: "1" });
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
