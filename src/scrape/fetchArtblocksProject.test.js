const { parseProjectData } = require("./fetchArtblocksProject");
const snapshots = require("./snapshots");

describe("scrape/fetchArtblocksProject", () => {
  const sc = new snapshots.SnapshotCache();

  it("parses a successful response", async () => {
    expect(
      parseProjectData(
        snapshots.ARCHETYPE,
        await sc.project(snapshots.ARCHETYPE)
      )
    ).toEqual({
      projectId: snapshots.ARCHETYPE,
      artistName: "Kjetil Golid",
      description: snapshots.ARCHETYPE_DESCRIPTION,
      scriptJson:
        '{"type":"p5js","version":"1.0.0","aspectRatio":"1","curation_status":"curated"}',
      name: "Archetype",
      maxInvocations: 600,
    });
  });

  it("parses a response with line breaks in description", async () => {
    expect(
      parseProjectData(
        snapshots.HYPERHASH,
        await sc.project(snapshots.HYPERHASH)
      )
    ).toEqual({
      projectId: snapshots.HYPERHASH,
      artistName: "Beervangeer",
      description: snapshots.HYPERHASH_DESCRIPTION,
      scriptJson:
        '{"type":"p5js","version":"1.0.0","aspectRatio":"1","curation_status":"curated"}',
      name: "HyperHash",
      maxInvocations: 369,
    });
  });

  it("parses a no-such-project response", () => {
    expect(parseProjectData(9999, "project does not exist")).toBe(null);
  });

  it("parses a phantom project response", async () => {
    expect(
      parseProjectData(
        snapshots.PHANTOM_SEADRAGONS,
        await sc.project(snapshots.PHANTOM_SEADRAGONS)
      )
    ).toBe(null);
  });
});
