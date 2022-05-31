const ethers = require("ethers");

const { acqrel } = require("./util");
const { testDbProvider } = require("./testUtil");

const adHocPromise = require("../util/adHocPromise");
const eth = require("./eth");

describe("db/eth", () => {
  const withTestDb = testDbProvider();

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
      const h0 =
        "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3";
      const h1 =
        "0x88e96d4537bea4d9c05d12549907b32561d3bf31f45aae734cdc119f13406cb6";
      const h2 =
        "0xb495a1d7e6663152ae92708da4843337b958146015a2802f4193a410044698c9";
      const hashes = [h0, h1, h2];

      const t0 = 0;
      const t1 = 1438269988;
      const t2 = 1438270017;
      const timestamps = [t0, t1, t2];

      expect(await eth.blockExists({ client, blockHash: h0 })).toEqual(false);
      expect(await eth.latestBlockHeader({ client })).toEqual(null);
      expect(
        await eth.findBlockHeadersSince({ client, minBlockNumber: 1 })
      ).toEqual([]);

      await eth.addBlocks({
        client,
        blocks: hashes.map((hash, number) => {
          const parentHash = hashes[number - 1] || ethers.constants.HashZero;
          const timestamp = timestamps[number];
          const block = { hash, parentHash, number, timestamp };
          return block;
        }),
      });

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
});
