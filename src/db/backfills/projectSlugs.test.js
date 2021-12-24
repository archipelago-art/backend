const { testDbProvider } = require("../testUtil");

const { parseProjectData } = require("../../scrape/fetchArtblocksProject");
const snapshots = require("../../scrape/snapshots");
const artblocks = require("../artblocks");
const backfillProjectSlugs = require("./projectSlugs");

describe("backfills/projectSlugs", () => {
  const withTestDb = testDbProvider();
  const sc = new snapshots.SnapshotCache();

  async function slugs(client) {
    const res = await client.query(`
      SELECT name, slug FROM projects
      ORDER BY project_id ASC
    `);
    return res.rows;
  }

  async function addProject(client, id) {
    return await artblocks.addProject({
      client,
      project: parseProjectData(id, await sc.project(id)),
    });
  }

  it(
    "populates slugs for multiple projects at once",
    withTestDb(async ({ client, pool }) => {
      await addProject(client, snapshots.SQUIGGLES);
      await addProject(client, snapshots.ARCHETYPE);
      await client.query(`UPDATE projects SET slug = NULL`);
      expect(await slugs(client)).toEqual([
        { name: "Chromie Squiggle", slug: null },
        { name: "Archetype", slug: null },
      ]);
      await backfillProjectSlugs({ pool });
      expect(await slugs(client)).toEqual([
        { name: "Chromie Squiggle", slug: "chromie-squiggle" },
        { name: "Archetype", slug: "archetype" },
      ]);
    })
  );

  it(
    "doesn't overwrite slugs that are already set",
    withTestDb(async ({ client, pool }) => {
      const squigglesNewid = await addProject(client, snapshots.SQUIGGLES);
      await addProject(client, snapshots.ARCHETYPE);
      await client.query(`UPDATE projects SET slug = NULL`);
      await artblocks.setProjectSlug({
        client,
        projectNewid: squigglesNewid,
        slug: "squigglez",
      });
      await backfillProjectSlugs({ pool });
      expect(await slugs(client)).toEqual([
        { name: "Chromie Squiggle", slug: "squigglez" },
        { name: "Archetype", slug: "archetype" },
      ]);
    })
  );
});
