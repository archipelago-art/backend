const {
  setLastUpdated,
  getLastUpdated,
  deleteLastUpdated,
  getProgress,
} = require("./progress");
const { testDbProvider } = require("../testUtil");
const { parseProjectData } = require("../../scrape/fetchArtblocksProject");
const artblocks = require("../artblocks");
const snapshots = require("../../scrape/snapshots");

describe("db/opensea/progress", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  it(
    "last updated is null if never set for a slug",
    withTestDb(async ({ client }) => {
      const slug = "awesome-drop-by-archipelago";
      const { projectId } = await sc.addProject(client, snapshots.ARCHETYPE);
      const result = await getLastUpdated({ client, slug, projectId });
      expect(result).toEqual(null);
    })
  );
  it(
    "last updated may be set, deleted, and retrieved",
    withTestDb(async ({ client }) => {
      const { projectId } = await sc.addProject(client, snapshots.ARCHETYPE);
      const slug = "awesome-drop-by-archipelago";

      expect(await deleteLastUpdated({ client, projectId })).toBe(false);

      const until1 = new Date("2021-01-01");
      await setLastUpdated({ client, slug, until: until1, projectId });
      expect(await getLastUpdated({ client, slug, projectId })).toEqual(until1);

      expect(await deleteLastUpdated({ client, projectId })).toBe(true);
      expect(await getLastUpdated({ client, slug, projectId })).toEqual(null);

      const until2 = new Date("2021-02-02");
      await setLastUpdated({ client, slug, until: until2, projectId });
      expect(await getLastUpdated({ client, slug, projectId })).toEqual(until2);
    })
  );
  it(
    "getProgress works",
    withTestDb(async ({ client }) => {
      const { projectId } = await sc.addProject(client, snapshots.ARCHETYPE);
      const slug = "awesome-drop-by-archipelago";
      const until = new Date("2021-01-01");
      await setLastUpdated({ client, slug, until, projectId });
      const progress = await getProgress({ client });
      const expected = [{ lastUpdated: until, slug, projectId }];
      expect(progress).toEqual(expected);
    })
  );
});
