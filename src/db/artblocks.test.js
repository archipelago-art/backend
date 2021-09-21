const { testDbProvider } = require("./testUtil");

const artblocks = require("./artblocks");

describe("db/artblocks", () => {
  const withTestDb = testDbProvider();

  it(
    "writes and reads a project",
    withTestDb(async ({ client }) => {
      const project = {
        projectId: 23,
        name: "Archetype",
        maxInvocations: 600,
      };
      await artblocks.addProject({ client, project });
      expect(await artblocks.getProject({ client, projectId: 23 })).toEqual(
        project
      );
    })
  );

  it(
    "fails on duplicate project ID",
    withTestDb(async ({ client }) => {
      const project = {
        projectId: 23,
        name: "Archetype",
        maxInvocations: 600,
      };
      await artblocks.addProject({ client, project });
      await expect(artblocks.addProject({ client, project })).rejects.toThrow();
    })
  );
});
