const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");
const snapshots = require("../scrape/snapshots");
const { parseProjectData } = require("../scrape/fetchArtblocksProject");
const { projectIdForSlug } = require("./projects");

describe("db/projects", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function addProject(client, projectId) {
    const project = await parseProjectData(
      projectId,
      await sc.project(projectId)
    );
    const id = await artblocks.addProject({ client, project });
    return { project, id };
  }

  describe("projectIdForSlug", () => {
    it(
      "can retrieve a project id by slug",
      withTestDb(async ({ client }) => {
        const { project, id } = await addProject(client, [snapshots.ARCHETYPE]);
        expect(await projectIdForSlug({ client, slug: "archetype" })).toEqual(
          id
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
