const ethers = require("ethers");
const luxon = require("luxon");
const { testDbProvider } = require("../db/testUtil");
const snapshots = require("../scrape/snapshots");
const eth = require("../db/eth");
const digest = require("./digest");
const { addBid } = require("../db/orderbook");
const priceToString = require("../util/priceToString");

describe("email/digest", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

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

  async function addProjects(client, projectIds) {
    const results = await sc.addProjects(client, projectIds);
    return results.map((x) => x.projectId);
  }

  async function addTokens(client, artblocksTokenIds) {
    const results = await sc.addTokens(client, artblocksTokenIds);
    return results.map((x) => x.tokenId);
  }

  function dummyTx(id) {
    return ethers.utils.id(`tx:${id}`);
  }
  function dummyAddress(id) {
    const hash = ethers.utils.id(`addr:${id}`);
    return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12));
  }

  it(
    "prepares a digest email properly",
    withTestDb(async ({ client }) => {
      // Helper function to make test bids
      async function makeBid({ scope, price, bidder }) {
        return await addBid({
          client,
          noVerify: true,
          scope,
          price,
          deadline: new Date("2099-01-01"),
          bidder,
          nonce: ethers.BigNumber.from("0xabcd").add(price),
          agreement: "0x",
          message: "0x",
          signature: "0x" + "fe".repeat(64) + "01",
        });
      }

      // Insert test data:
      //   Projects
      //   Tokens (for projects)
      //   ERC-721 transactions (for tokens)
      //   Bids (for tokens)
      await client.query("BEGIN");
      await addProjects(client, [
        snapshots.GENESIS,
        snapshots.SQUIGGLES,
        snapshots.ARCHETYPE,
      ]);
      const [genZero, squiggle, archCube, arch1, arch2, arch3, arch66] =
        await addTokens(client, [
          snapshots.GENESIS_ZERO,
          snapshots.PERFECT_CHROMATIC,
          snapshots.THE_CUBE,
          snapshots.ARCH_TRIPTYCH_1,
          snapshots.ARCH_TRIPTYCH_2,
          snapshots.ARCH_TRIPTYCH_3,
          snapshots.ARCH_66,
        ]);

      const zeroAddress = ethers.constants.AddressZero;
      const aliceAddress = dummyAddress("alice");
      const bobAddress = dummyAddress("bob");
      const camilleAddress = dummyAddress("camille");

      const blocks = realBlocks();
      await eth.addBlocks({ client, blocks });

      const aliceMintsGenZero = {
        tokenId: genZero,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 1,
        transactionHash: dummyTx(1),
      };
      const aliceMintsSquiggle = {
        tokenId: squiggle,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 2,
        transactionHash: dummyTx(2),
      };
      const aliceMintsArchCube = {
        tokenId: archCube,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 3,
        transactionHash: dummyTx(3),
      };
      const aliceMintsArch1 = {
        tokenId: arch1,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 4,
        transactionHash: dummyTx(4),
      };
      const aliceMintsArch2 = {
        tokenId: arch2,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 5,
        transactionHash: dummyTx(5),
      };
      const aliceMintsArch3 = {
        tokenId: arch3,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 6,
        transactionHash: dummyTx(6),
      };
      const aliceMintsArch66 = {
        tokenId: arch66,
        fromAddress: zeroAddress,
        toAddress: aliceAddress,
        blockHash: blocks[0].hash,
        logIndex: 7,
        transactionHash: dummyTx(7),
      };
      await eth.addErc721Transfers({
        client,
        transfers: [
          aliceMintsGenZero,
          aliceMintsSquiggle,
          aliceMintsArchCube,
          aliceMintsArch1,
          aliceMintsArch2,
          aliceMintsArch3,
          aliceMintsArch66,
        ],
      });

      const topBid = "99000000000000000000";
      const secondBid = "56700000000000000000";
      const thirdBid = "22100000000000000000";
      const fourthBid = "3500000000000000000";
      const lowBid = "1100000000000000000";

      await makeBid({
        scope: { type: "TOKEN", tokenId: genZero },
        price: thirdBid,
        bidder: bobAddress,
      });
      await makeBid({
        scope: { type: "TOKEN", tokenId: squiggle },
        price: topBid,
        bidder: camilleAddress,
      });
      await makeBid({
        scope: { type: "TOKEN", tokenId: archCube },
        price: secondBid,
        bidder: bobAddress,
      });
      await makeBid({
        scope: { type: "TOKEN", tokenId: arch1 },
        price: fourthBid,
        bidder: bobAddress,
      });
      await makeBid({
        scope: { type: "TOKEN", tokenId: arch2 },
        price: lowBid,
        bidder: bobAddress,
      });
      await makeBid({
        scope: { type: "TOKEN", tokenId: arch3 },
        price: lowBid,
        bidder: camilleAddress,
      });
      await makeBid({
        scope: { type: "TOKEN", tokenId: arch66 },
        price: lowBid,
        bidder: camilleAddress,
      });
      await client.query("COMMIT");

      // Prepare the template data
      const currentTime = luxon.DateTime.local();
      const lastEmailTime = currentTime.minus({ days: 2 }).toJSDate();
      const emailData = await digest.prepareTemplateData({
        client,
        account: aliceAddress,
        lastEmailTime,
      });

      // Verify results
      expect(emailData.address).toBe(aliceAddress);
      expect(emailData.totalBids).toEqual(7);
      expect(
        emailData.bids.top3.map((b) => {
          return b.label;
        })
      ).toEqual(["Chromie Squiggle #7583", "Archetype #250", "Genesis #0"]);
      expect(
        emailData.bids.top3.map((b) => {
          return b.formattedPrice;
        })
      ).toEqual([
        priceToString(topBid),
        priceToString(secondBid),
        priceToString(thirdBid),
      ]);
      expect(emailData.bids.next3.length).toBe(3);
      expect(emailData.bids.more.length).toBe(1);
    })
  );
});
