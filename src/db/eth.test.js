const ethers = require("ethers");

const { acqrel, bufToAddress, bufToHex } = require("./util");
const { testDbProvider } = require("./testUtil");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const adHocPromise = require("../util/adHocPromise");
const Cmp = require("../util/cmp");
const artblocks = require("./artblocks");
const eth = require("./eth");
const orderbook = require("./orderbook");
const wellKnownCurrencies = require("./wellKnownCurrencies");
const ws = require("./ws");

const SIG_DIRTY = "0x" + "fe".repeat(64) + "01";

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
      expect(await eth.getJobs({ client })).toEqual([]);

      await eth.addJob({
        client,
        jobId: 0,
        lastBlockNumber: 123,
        type: "addFoos",
        args: { fooFilter: "large" },
      });
      await eth.addJob({
        client,
        jobId: 1,
        lastBlockNumber: -1,
        type: "addBars",
        args: "barestring",
      });

      expect(await eth.getJobs({ client })).toEqual([
        {
          jobId: 0,
          lastBlockNumber: 123,
          type: "addFoos",
          args: { fooFilter: "large" },
        },
        { jobId: 1, lastBlockNumber: -1, type: "addBars", args: "barestring" },
      ]);

      expect(
        await eth.updateJobProgress({ client, jobId: 1, lastBlockNumber: 7 })
      ).toBe(true);
      expect(
        await eth.updateJobProgress({ client, jobId: 2, lastBlockNumber: 999 })
      ).toBe(false);

      expect(
        await eth.updateJobSpec({
          client,
          jobId: 1,
          type: "addBarsV2",
          args: null,
        })
      ).toBe(true);

      expect(await eth.getJobs({ client })).toEqual([
        {
          jobId: 0,
          lastBlockNumber: 123,
          type: "addFoos",
          args: { fooFilter: "large" },
        },
        {
          jobId: 1,
          lastBlockNumber: 7,
          type: "addBarsV2",
          args: null,
        },
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

  function dummyTx(id) {
    return ethers.utils.id(`tx:${id}`);
  }
  function dummyAddress(id) {
    const hash = ethers.utils.id(`addr:${id}`);
    return ethers.utils.getAddress(ethers.utils.hexDataSlice(hash, 12));
  }

  describe("erc721_transfers", () => {
    it(
      "adds and removes transfers across different blocks, updating ask activity",
      withTestDb(async ({ pool, client }) => {
        await addProjects(client, [snapshots.SQUIGGLES, snapshots.ARCHETYPE]);
        const [squiggle, cube] = await addTokens(client, [
          snapshots.PERFECT_CHROMATIC,
          snapshots.THE_CUBE,
        ]);

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

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
        const aliceSendsSquiggle = {
          tokenId: squiggle,
          fromAddress: alice,
          toAddress: bob,
          blockHash: blocks[0].hash,
          logIndex: 4,
          transactionHash: dummyTx(3),
        };
        const bobMintsCube = {
          tokenId: cube,
          fromAddress: zero,
          toAddress: bob,
          blockHash: blocks[2].hash,
          logIndex: 2,
          transactionHash: dummyTx(2),
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

        const askId = await orderbook.addAsk({
          client,
          tokenId: squiggle,
          price: "1000",
          deadline: new Date("2099-01-01"),
          asker: alice,
          nonce: "999",
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        async function isAskActive() {
          const res = await orderbook.floorAsk({ client, tokenId: squiggle });
          return res != null;
        }
        // Alice doesn't start out owning the token.
        await client.query(
          `
          UPDATE asks
          SET active_token_owner = false, active = false
          WHERE ask_id = $1::askid
          `,
          [askId]
        );

        expect(await isAskActive()).toBe(false);
        expect(await summarizeTransfers()).toEqual([]);
        await eth.addErc721Transfers({
          client,
          transfers: [
            aliceMintsSquiggle,
            bobMintsCube,
            aliceSendsSquiggle,
            bobReturnsSquiggleLater,
          ],
        });
        expect(await isAskActive()).toBe(true); // Bob sent to Alice
        const messages = await ws.getMessages({
          client,
          topic: "chromie-squiggle",
          since: new Date(0),
        });
        expect(messages).toEqual(
          expect.arrayContaining([
            {
              messageId: expect.any(String),
              timestamp: expect.any(String),
              type: "TOKEN_TRANSFERRED",
              topic: "chromie-squiggle",
              data: {
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
              },
            },
          ])
        );
        expect(await summarizeTransfers()).toEqual([
          { ...aliceMintsSquiggle, blockNumber: 0 },
          { ...aliceSendsSquiggle, blockNumber: 0 },
          { ...bobMintsCube, blockNumber: 2 },
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
          blockHash: blocks[2].hash,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_LEGACY,
        });
        expect(await summarizeTransfers()).toEqual([
          { ...aliceMintsSquiggle, blockNumber: 0 }, // different block
          { ...aliceSendsSquiggle, blockNumber: 0 }, // different block
          { ...bobMintsCube, blockNumber: 2 }, // different contract address
        ]);
        expect(await isAskActive()).toBe(false); // no longer true that Bob sent to Alice
      })
    );
  });

  describe("nonce_cancellations", () => {
    it(
      "adds and removes nonce cancellations, updating order activity",
      withTestDb(async ({ client }) => {
        await addProjects(client, [snapshots.SQUIGGLES]);
        const [tokenId] = await addTokens(client, [
          snapshots.PERFECT_CHROMATIC,
        ]);

        const zero = ethers.constants.AddressZero;
        const alice = dummyAddress("alice");
        const market = dummyAddress("market");

        const nonce = 12345;

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

        const mintTransfer = {
          tokenId,
          fromAddress: zero,
          toAddress: alice,
          blockHash: blocks[0].hash,
          logIndex: 1,
          transactionHash: dummyTx(1),
        };
        await eth.addErc721Transfers({ client, transfers: [mintTransfer] });

        const askId = await orderbook.addAsk({
          client,
          tokenId,
          price: "1000",
          deadline: new Date("2099-01-01"),
          asker: alice,
          nonce,
          agreement: "0x",
          message: "0x",
          signature: SIG_DIRTY,
        });
        async function isAskActive() {
          const res = await orderbook.floorAsk({ client, tokenId });
          return res != null;
        }

        expect(await isAskActive()).toBe(true);

        const cancellation1 = {
          account: alice,
          nonce,
          blockHash: blocks[1].hash,
          logIndex: 2,
          transactionHash: dummyTx(2),
        };
        const cancellation2 = {
          ...cancellation1,
          blockHash: blocks[2].hash,
          logIndex: 3,
          transactionHash: dummyTx(3),
        }; // duplicate
        const n0 = await eth.addNonceCancellations({
          client,
          marketContract: market,
          cancellations: [cancellation1, cancellation2],
        });
        expect(n0).toEqual(1);

        expect(await isAskActive()).toBe(false);

        // Delete the duplicate, doing nothing...
        const n1 = await eth.deleteNonceCancellations({
          client,
          marketContract: market,
          blockHash: blocks[2].hash,
        });
        expect(n1).toBe(0);
        expect(await isAskActive()).toBe(false);

        // ...then the original, re-activating the ask.
        const n2 = await eth.deleteNonceCancellations({
          client,
          marketContract: market,
          blockHash: blocks[1].hash,
        });
        expect(n2).toBe(1);
        expect(await isAskActive()).toBe(true);
      })
    );
  });

  describe("fills", () => {
    it(
      "records fills for known and unknown tokens and sends ws messages",
      withTestDb(async ({ client }) => {
        await addProjects(client, [snapshots.ARCHETYPE]);
        const [tokenId] = await addTokens(client, [snapshots.THE_CUBE]);

        const alice = dummyAddress("alice");
        const bob = dummyAddress("bob");
        const market = dummyAddress("market");

        const otherTokenContract = dummyAddress("other-token");
        const otherOnChainTokenId = "9876";
        const otherCurrency = dummyAddress("other-currency");

        const [tradeId1, tradeId2] = [
          ethers.utils.id("tradeid:1"),
          ethers.utils.id("tradeid:2"),
        ].sort();

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

        const aliceSellsCube = {
          tradeId: tradeId1,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
          onChainTokenId: snapshots.THE_CUBE,
          buyer: bob.toLowerCase(),
          seller: alice.toLowerCase(),
          currency: wellKnownCurrencies.weth9.address,
          price: "1000",
          proceeds: "995",
          cost: "1005",
          blockHash: blocks[1].hash,
          logIndex: 1,
          transactionHash: dummyTx(1),
        };
        const bobSellsOtherToken = {
          tradeId: tradeId2,
          tokenContract: otherTokenContract,
          onChainTokenId: otherOnChainTokenId,
          buyer: alice,
          seller: bob,
          currency: otherCurrency,
          price: "2345",
          proceeds: "2345",
          cost: "2345",
          blockHash: blocks[2].hash,
          logIndex: 2,
          transactionHash: dummyTx(2),
        };
        const fills = [aliceSellsCube, bobSellsOtherToken];
        await eth.addFills({ client, marketContract: market, fills });

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
              type: "TOKEN_TRADED",
              topic: "archetype",
              data: {
                tradeId: tradeId1,
                slug: "archetype",
                tokenIndex: 250,
                blockTimestamp: new Date(
                  blocks[1].timestamp * 1000
                ).toISOString(),
                tokenId,
                buyer: bob,
                seller: alice,
                currency: wellKnownCurrencies.weth9.address,
                price: "1000",
                proceeds: "995",
                cost: "1005",
                blockHash: blocks[1].hash,
                blockNumber: blocks[1].number,
                logIndex: 1,
                transactionHash: dummyTx(1),
              },
            },
          ])
        );
        // No event for the unknown token...
        expect(messages).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "TOKEN_TRADED",
              data: expect.objectContaining({ tradeId: tradeId2 }),
            }),
          ])
        );
        // ...but it should still have a fill.
        async function getTradeIds() {
          const res = await client.query(
            'SELECT trade_id AS "tradeId" FROM fills'
          );
          return res.rows.map((r) => bufToHex(r.tradeId)).sort();
        }
        expect(await getTradeIds()).toEqual([tradeId1, tradeId2]);

        const n = await eth.deleteFills({
          client,
          marketContract: market,
          blockHash: blocks[2].hash,
        });
        expect(n).toEqual(1);
        expect(await getTradeIds()).toEqual([tradeId1]);
      })
    );
  });

  describe("erc20_deltas and erc20_balances", () => {
    it(
      "records deltas and updates balances",
      withTestDb(async ({ client }) => {
        const [alice, bob] = [dummyAddress("alice"), dummyAddress("bob")].sort(
          Cmp.comparing((x) => x.toLowerCase())
        );
        const market = dummyAddress("market");

        const weth = wellKnownCurrencies.weth9.currencyId;

        const blocks = realBlocks();
        await eth.addBlocks({ client, blocks });

        const aliceDepositsWeth = [
          {
            account: alice,
            blockHash: blocks[0].hash,
            delta: 100,
          },
        ];
        const alicePaysBob = [
          {
            account: alice,
            blockHash: blocks[1].hash,
            delta: -50,
          },
          {
            account: bob,
            blockHash: blocks[1].hash,
            delta: 50,
          },
        ];
        const bobWithdrawsWeth = [
          {
            account: bob,
            blockHash: blocks[1].hash,
            delta: -25,
          },
        ];

        async function checkBalances(currencyId) {
          // Get balances from `erc20_balances` and also verify that the deltas
          // in `erc20_deltas` still add up to the balances.
          const res = await client.query(
            `
            SELECT account, balance, coalesce(delta_sum, '0') AS "deltaSum"
            FROM
              (
                SELECT account, balance FROM erc20_balances
                WHERE currency_id = $1::currencyid
              ) AS by_balance
              FULL OUTER JOIN
              (
                SELECT account, sum(delta) AS delta_sum FROM erc20_deltas
                WHERE currency_id = $1::currencyid
                GROUP BY account
              ) AS by_delta
              USING (account)
            ORDER BY account
            `,
            [currencyId]
          );
          const result = {};
          for (const { account, balance, deltaSum } of res.rows) {
            if (balance !== deltaSum) {
              throw new Error(
                `${bufToAddress(account)}: ${balance} !== ${deltaSum}`
              );
            }
            result[bufToAddress(account)] = Number(balance); // for convenience
          }
          return result;
        }
        expect(await checkBalances(weth)).toEqual({});

        const deltas = [
          ...aliceDepositsWeth,
          ...alicePaysBob,
          ...bobWithdrawsWeth,
        ];
        await eth.addErc20Deltas({ client, currencyId: weth, deltas });
        expect(await checkBalances(weth)).toEqual({ [alice]: 50, [bob]: 25 });
        await eth.deleteErc20Deltas({
          client,
          currencyId: weth,
          blockHash: blocks[1].hash,
        });
        expect(await checkBalances(weth)).toEqual({ [alice]: 100, [bob]: 0 });
      })
    );

    it(
      "throws if any intermediate balance would overflow/underflow uint256",
      withTestDb(async ({ client }) => {
        const weth = wellKnownCurrencies.weth9.currencyId;
        const block = realBlocks()[0];
        await eth.addBlocks({ client, blocks: [block] });

        const alice = dummyAddress("alice");
        function delta(d) {
          return {
            account: alice,
            blockHash: block.hash,
            delta: d,
          };
        }

        async function expectFailure(deltas, message) {
          await client.query("BEGIN");
          await expect(() =>
            eth.addErc20Deltas({
              client,
              currencyId: weth,
              deltas,
              alreadyInTransaction: true,
            })
          ).rejects.toThrow(message);
          await client.query("ROLLBACK");
        }

        const underflow = [
          delta(100), // balance: 100
          delta(-80), // balance: 20
          delta(-80), // balance: -60 => underflow!
          delta(100), // balance: 40
        ];
        await expectFailure(underflow, "dropped below zero to -60");

        const overflow = [
          delta(ethers.constants.MaxUint256.sub(100)), // balance: max - 100
          delta(80), // balance: max - 20
          delta(80), // balance: max + 60 => overflow!
          delta(-100), // balance: max - 20
        ];
        await expectFailure(
          overflow,
          "rose above MaxUint256 to " +
            ethers.constants.MaxUint256.add(60).toString()
        );
      })
    );
  });
});
