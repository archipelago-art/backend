const { parseProjectData } = require("./fetchArtblocksProject");
const snapshots = require("./snapshots");

describe("scrape/fetchArtblocksProject", () => {
  let rawArchetype;
  beforeAll(async () => {
    rawArchetype = await snapshots.readProject(snapshots.ARCHETYPE);
  });

  it("parses a successful response", () => {
    expect(parseProjectData(snapshots.ARCHETYPE, rawArchetype)).toEqual({
      projectId: snapshots.ARCHETYPE,
      name: "Archetype",
      maxInvocations: 600,
    });
  });
});
