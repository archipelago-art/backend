const { acqrel, bufToAddress } = require("./util");
const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const channels = require("./channels");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const adHocPromise = require("../util/adHocPromise");

describe("db/artacle", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  it(
    "updating rarity and retrieving it works properly",
    withTestDb(async ({ client }) => {
      await addTestData(client);
      await expect(() =>
        artblocks.addToken({
          client,
          tokenContract: artblocks.CONTRACT_ARTBLOCKS_STANDARD,
          artblocksTokenId: 1000001,
          rawTokenData: JSON.stringify({ features: { Size: "weird" } }),
        })
      ).rejects.toThrow("violates unique constraint");
    })
  );
});
