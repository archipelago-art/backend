const { parseProjectData } = require("./fetchArtblocksProject");
const snapshots = require("./snapshots");

describe("scrape/fetchArtblocksProject", () => {
  let rawArchetype, rawPhantomSeadragons;
  beforeAll(async () => {
    rawArchetype = await snapshots.readProject(snapshots.ARCHETYPE);
    rawPhantomSeadragons = await snapshots.readProject(
      snapshots.PHANTOM_SEADRAGONS
    );
  });

  it("parses a successful response", () => {
    expect(parseProjectData(snapshots.ARCHETYPE, rawArchetype)).toEqual({
      projectId: snapshots.ARCHETYPE,
      artistName: "Kjetil Golid",
      name: "Archetype",
      maxInvocations: 600,
    });
  });

  it("parses a no-such-project response", () => {
    expect(parseProjectData(9999, "project does not exist")).toBe(null);
  });

  it("parses a phantom project response", () => {
    expect(
      parseProjectData(snapshots.PHANTOM_SEADRAGONS, rawPhantomSeadragons)
    ).toBe(null);
  });
});
