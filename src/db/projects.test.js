const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const { projectIdForSlug } = require("./projects");

describe("db/projects", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  describe("projectIdForSlug", () => {
    it(
      "can retrieve a project id by slug",
      withTestDb(async ({ client }) => {
        const { projectId } = await sc.addProject(client, snapshots.ARCHETYPE);
        expect(await projectIdForSlug({ client, slug: "archetype" })).toEqual(
          projectId
        );
      })
    );
    it(
      "returns null if there is no project with that slug",
      withTestDb(async ({ client }) => {
        expect(await projectIdForSlug({ client, slug: "foo" })).toEqual(null);
      })
    );
  });
});
