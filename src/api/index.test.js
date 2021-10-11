const { testDbProvider } = require("../db/testUtil");

const api = require(".");
const artblocks = require("../db/artblocks");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const snapshots = require("../scrape/snapshots");

describe("api", () => {
  const withTestDb = testDbProvider();
  let squiggles;
  let archetype;
  beforeAll(async () => {
    squiggles = parseProjectData(
      snapshots.SQUIGGLES,
      await snapshots.readProject(snapshots.SQUIGGLES)
    );
    archetype = parseProjectData(
      snapshots.ARCHETYPE,
      await snapshots.readProject(snapshots.ARCHETYPE)
    );
  });

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      await artblocks.addProject({ client, project: archetype });
      await artblocks.addProject({ client, project: squiggles });
      const res = await api.collections({ client });
      expect(res).toEqual([
        {
          id: "ab-0",
          name: "Chromie Squiggle",
          artistName: "Snowfro",
        },
        {
          id: "ab-23",
          name: "Archetype",
          artistName: "Kjetil Golid",
        },
      ]);
    })
  );
});
