const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");

describe("api", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const archetype = parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      );
      const squiggles = parseProjectData(
        snapshots.SQUIGGLES,
        await sc.project(snapshots.SQUIGGLES)
      );
      const theCube = await sc.token(snapshots.THE_CUBE);
      await artblocks.addProject({ client, project: archetype });
      await artblocks.addProject({ client, project: squiggles });
      await artblocks.addToken({
        client,
        tokenId: snapshots.THE_CUBE,
        rawTokenData: theCube,
      });
      const res = await api.collections({ client });
      expect(res).toEqual([
        {
          id: "ab-0",
          name: "Chromie Squiggle",
          artistName: "Snowfro",
          description: expect.stringContaining(
            "the soul of the Art Blocks platform"
          ),
          aspectRatio: 1.5,
          numTokens: 0,
        },
        {
          id: "ab-23",
          name: "Archetype",
          artistName: "Kjetil Golid",
          description: expect.stringContaining("repetition as a counterweight"),
          aspectRatio: 1,
          numTokens: 1,
        },
      ]);
    })
  );
});
