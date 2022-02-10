const ethers = require("ethers");

const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");
const artblocks = require("./artblocks");
const erc721Transfers = require("./erc721Transfers");
const { testDbProvider } = require("./testUtil");
const { bufToHex, hexToBuf } = require("./util");

describe("db/erc721Transfers", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  function dummyAddress(name) {
    const entropy = ethers.utils.id(`address:${name}`);
    const rawAddr = entropy.slice(0, ethers.constants.AddressZero.length);
    return ethers.utils.getAddress(rawAddr);
  }

  function transfer({
    contractAddress = artblocks.CONTRACT_ARTBLOCKS_STANDARD,
    tokenId = snapshots.THE_CUBE,
    fromAddress = null,
    toAddress = null,
    blockNumber = 12164300,
    blockHash = ethers.utils.id(`block:${blockNumber}`),
    logIndex = 123,
    transactionHash = "0x" + "fe".repeat(32),
    transactionIndex = 77,
  } = {}) {
    if (fromAddress == null) throw new Error("fromAddress: " + fromAddress);
    if (toAddress == null) throw new Error("toAddress: " + toAddress);
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

  async function addTokens(client, artblocksTokenIds) {
    const tokens = await Promise.all(
      artblocksTokenIds.map(async (artblocksTokenId) => ({
        artblocksTokenId,
        rawTokenData: await sc.token(artblocksTokenId),
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

  describe("getTransferCount", () => {
    it(
      "returns the right answers with zero, one, or more transfers",
      withTestDb(async ({ client }) => {
        await addProjects(client, [snapshots.ARCHETYPE]);
        await addTokens(client, [snapshots.THE_CUBE]);

        const zero = ethers.constants.AddressZero;
        const alice = dummyAddress("alice");
        const bob = dummyAddress("bob");

        let nextBlockNumber = 12164300;
        function makeTransfer(fromAddress, toAddress) {
          return transfer({
            fromAddress,
            toAddress,
            blockNumber: nextBlockNumber++,
          });
        }
        const mint = makeTransfer(zero, alice);
        const bip = makeTransfer(alice, bob);
        const bop = makeTransfer(bob, alice);
        const boop = makeTransfer(alice, bob);
        const transfers = [mint, bip, bop, boop];
        await erc721Transfers.addTransfers({ client, transfers });

        async function count(fromAddress, toAddress) {
          return await erc721Transfers.getTransferCount({
            client,
            fromAddress,
            toAddress,
          });
        }

        expect(await count(zero, alice)).toEqual(1);
        expect(await count(zero, bob)).toEqual(0);
        expect(await count(alice, bob)).toEqual(2);
        expect(await count(alice, zero)).toEqual(0);
        expect(await count(bob, alice)).toEqual(1);
        expect(await count(bob, zero)).toEqual(0);

        const cheryl = dummyAddress("cheryl"); // neerbefore seen
        expect(await count(zero, cheryl)).toEqual(0);
        expect(await count(cheryl, zero)).toEqual(0);
        expect(await count(alice, cheryl)).toEqual(0);
        expect(await count(cheryl, alice)).toEqual(0);
      })
    );
  });
});
