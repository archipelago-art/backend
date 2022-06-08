const ethers = require("ethers");

const { acqrel, bufToAddress, bufToHex } = require("./util");
const { testDbProvider } = require("./testUtil");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const adHocPromise = require("../util/adHocPromise");
const artblocks = require("./artblocks");
const { websocketMessages } = require("./channels");
const eth = require("./eth");

describe("db/eth", () => {
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

  it(
    "gets and sets job progress",
    withTestDb(async ({ client }) => {
      expect(await eth.getJobProgress({ client })).toEqual([]);

      await eth.addJob({ client, jobId: 0, lastBlockNumber: 123 });
      await eth.addJob({ client, jobId: 1, lastBlockNumber: -1 });

      expect(await eth.getJobProgress({ client })).toEqual([
        { jobId: 0, lastBlockNumber: 123 },
        { jobId: 1, lastBlockNumber: -1 },
      ]);

      await eth.updateJobProgress({ client, jobId: 1, lastBlockNumber: 7 });
      await eth.updateJobProgress({ client, jobId: 2, lastBlockNumber: 999 });

      expect(await eth.getJobProgress({ client })).toEqual([
        { jobId: 0, lastBlockNumber: 123 },
        { jobId: 1, lastBlockNumber: 7 },
      ]);
    })
  );

  it(
    "manipulates and describes block headers",
    withTestDb(async ({ client }) => {
      const [h0, h1, h2] = realBlocks().map((b) => b.hash);
      const [t0, t1, t2] = realBlocks().map((b) => b.timestamp);

      expect(await eth.blockExists({ client, blockHash: h0 })).toEqual(false);
      expect(await eth.latestBlockHeader({ client })).toEqual(null);
      expect(
        await eth.findBlockHeadersSince({ client, minBlockNumber: 1 })
      ).toEqual([]);

      await eth.addBlocks({ client, blocks: realBlocks() });

      expect(await eth.blockExists({ client, blockHash: h0 })).toEqual(true);
      expect(await eth.blockExists({ client, blockHash: h2 })).toEqual(true);
      expect(await eth.latestBlockHeader({ client })).toEqual({
        blockHash: h2,
        parentHash: h1,
        blockNumber: 2,
        blockTimestamp: new Date(t2 * 1000),
      });
      expect(
        await eth.findBlockHeadersSince({ client, minBlockNumber: 1 })
      ).toEqual([
        { blockHash: h2, blockNumber: 2 },
        { blockHash: h1, blockNumber: 1 },
      ]);

      await eth.deleteBlock({ client, blockHash: h2 });
      expect(await eth.blockExists({ client, blockHash: h2 })).toEqual(false);
      expect(await eth.latestBlockHeader({ client })).toEqual({
        blockHash: h1,
        parentHash: h0,
        blockNumber: 1,
        blockTimestamp: new Date(t1 * 1000),
      });
      expect(
        await eth.findBlockHeadersSince({ client, minBlockNumber: 1 })
      ).toEqual([{ blockHash: h1, blockNumber: 1 }]);
    })
  );

  it(
    "handles parent hash null/zeroness",
    withTestDb(async ({ pool }) => {
      const hash =
        "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3";
      const nonzeroGenesisParent = {
        hash,
        parentHash: ethers.utils.id("not the zero hash"),
        number: 0,
        timestamp: 0,
      };
      await expect(
        acqrel(pool, (client) =>
          eth.addBlocks({ client, blocks: [nonzeroGenesisParent] })
        )
      ).rejects.toThrow("genesis block parent hash should be");

      const explicitlyNullParent = {
        hash,
        parentHash: null,
        number: 0,
        timestamp: 0,
      };
      await expect(
        acqrel(pool, (client) =>
          eth.addBlocks({ client, blocks: [explicitlyNullParent] })
        )
      ).rejects.toThrow("expected 0x-string; got: null");

      const properGenesis = {
        hash,
        parentHash: ethers.constants.HashZero,
        number: 0,
        timestamp: 0,
      };
      await acqrel(pool, async (client) => {
        await eth.addBlocks({ client, blocks: [properGenesis] });
        expect(await eth.latestBlockHeader({ client })).toEqual({
          blockHash: hash,
          parentHash: ethers.constants.HashZero,
          blockNumber: 0,
          blockTimestamp: new Date(0),
        });
      });
    })
  );

  it(
    "prevents adding blocks with unknown parents",
    withTestDb(async ({ client }) => {
      const b0 = {
        hash: "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
        parentHash: ethers.constants.HashZero,
        number: 0,
        timestamp: 0,
      };
      const b1 /* bad */ = {
        hash: "0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6",
        parentHash: ethers.utils.id("but you have not heard of me"),
        number: 1,
        timestamp: 1438269988,
      };
      await expect(eth.addBlocks({ client, blocks: [b0, b1] })).rejects.toThrow(
        'foreign key constraint "eth_blocks_parent_hash_fkey"'
      );
    })
  );

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
  async function addTokens(client, tokenIds) {
    const tokens = await Promise.all(
      tokenIds.map(async (id) => ({
        artblocksTokenId: id,
        rawTokenData: await sc.token(id),
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

  describe("erc721_transfers", () => {
    it(
      "adds and removes transfers across different blocks",
      withTestDb(async ({ pool, client }) => {
        await addProjects(client, [snapshots.SQUIGGLES, snapshots.ARCHETYPE]);
        const [squiggle, cube] = await addTokens(client, [
          snapshots.PERFECT_CHROMATIC,
          snapshots.THE_CUBE,
        ]);

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

        function dummyTx(id) {
          return ethers.utils.id(`tx:${id}`);
        }
        function dummyAddress(id) {
          const hash = ethers.utils.id(`addr:${id}`);
          return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12));
        }
        const zero = ethers.constants.AddressZero;
        const alice = dummyAddress("alice");
        const bob = dummyAddress("bob");

        const aliceMintsSquiggle = {
          tokenId: squiggle,
          fromAddress: zero,
          toAddress: alice,
          blockHash: blocks[0].hash,
          logIndex: 1,
          transactionHash: dummyTx(1),
        };
        const bobMintsCube = {
          tokenId: cube,
          fromAddress: zero,
          toAddress: bob,
          blockHash: blocks[0].hash,
          logIndex: 2,
          transactionHash: dummyTx(2),
        };
        const aliceSendsSquiggle = {
          tokenId: squiggle,
          fromAddress: alice,
          toAddress: bob,
          blockHash: blocks[0].hash,
          logIndex: 4,
          transactionHash: dummyTx(3),
        };
        const bobReturnsSquiggleLater = {
          tokenId: squiggle,
          fromAddress: bob,
          toAddress: alice,
          blockHash: blocks[2].hash,
          logIndex: 7,
          transactionHash: dummyTx(3),
        };

        async function summarizeTransfers() {
          const res = await client.query(
            `
            SELECT
              token_id AS "tokenId",
              from_address AS "fromAddress",
              to_address AS "toAddress",
              block_hash AS "blockHash",
              block_number AS "blockNumber",
              log_index AS "logIndex",
              transaction_hash AS "transactionHash"
            FROM erc721_transfers
            ORDER BY block_number, log_index
            `
          );
          return res.rows.map((r) => ({
            tokenId: r.tokenId,
            fromAddress: bufToAddress(r.fromAddress),
            toAddress: bufToAddress(r.toAddress),
            blockHash: bufToHex(r.blockHash),
            blockNumber: r.blockNumber,
            logIndex: r.logIndex,
            transactionHash: bufToHex(r.transactionHash),
          }));
        }

        expect(await summarizeTransfers()).toEqual([]);
        await acqrel(pool, async (listenClient) => {
          const postgresEvent = adHocPromise();
          listenClient.on("notification", (n) => {
            if (n.channel === websocketMessages.name) {
              postgresEvent.resolve(n.payload);
            } else {
              postgresEvent.reject("unexpected channel: " + n.channel);
            }
          });
          await websocketMessages.listen(listenClient);

          await eth.addErc721Transfers({
            client,
            transfers: [
              aliceMintsSquiggle,
              bobMintsCube,
              aliceSendsSquiggle,
              bobReturnsSquiggleLater,
            ],
          });
          const eventValue = await postgresEvent.promise;
          expect(JSON.parse(eventValue)).toEqual({
            type: "TOKEN_TRANSFERRED",
            slug: "chromie-squiggle",
            tokenIndex: 7583,
            blockTimestamp: "1970-01-01T00:00:00.000Z",
            tokenId: expect.any(String),
            fromAddress: alice,
            toAddress: bob,
            blockHash: blocks[0].hash,
            blockNumber: 0,
            logIndex: 4,
            transactionHash: dummyTx(3),
          });
        });
        expect(await summarizeTransfers()).toEqual([
          { ...aliceMintsSquiggle, blockNumber: 0 },
          { ...bobMintsCube, blockNumber: 0 },
          { ...aliceSendsSquiggle, blockNumber: 0 },
          { ...bobReturnsSquiggleLater, blockNumber: 2 },
        ]);
        expect(
          await eth.getTransfersForToken({ client, tokenId: squiggle })
        ).toEqual(
          [aliceMintsSquiggle, aliceSendsSquiggle, bobReturnsSquiggleLater].map(
            (e) => ({
              blockNumber: blocks.find((b) => b.hash === e.blockHash).number,
              logIndex: e.logIndex,
              transactionHash: e.transactionHash,
              blockHash: e.blockHash,
              timestamp: new Date(
                1000 * blocks.find((b) => b.hash === e.blockHash).timestamp
              ),
              from: e.fromAddress,
              to: e.toAddress,
            })
          )
        );
        expect(
          await eth.getTransferCount({
            client,
            fromAddress: alice,
            toAddress: bob,
          })
        ).toEqual(1);
        await eth.deleteErc721Transfers({
          client,
          blockHash: blocks[0].hash,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
        });
        expect(await summarizeTransfers()).toEqual([
          { ...bobMintsCube, blockNumber: 0 }, // different contract address
          { ...bobReturnsSquiggleLater, blockNumber: 2 }, // different block
        ]);
      })
    );
  });
});
