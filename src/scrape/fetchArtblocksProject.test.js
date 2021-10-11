const { parseProjectData } = require("./fetchArtblocksProject");
const snapshots = require("./snapshots");

describe("scrape/fetchArtblocksProject", () => {
  let rawHyperhash, rawArchetype, rawPhantomSeadragons;
  beforeAll(async () => {
    rawHyperhash = await snapshots.readProject(snapshots.HYPERHASH);
    rawArchetype = await snapshots.readProject(snapshots.ARCHETYPE);
    rawPhantomSeadragons = await snapshots.readProject(
      snapshots.PHANTOM_SEADRAGONS
    );
  });

  it("parses a successful response", () => {
    expect(parseProjectData(snapshots.ARCHETYPE, rawArchetype)).toEqual({
      projectId: snapshots.ARCHETYPE,
      artistName: "Kjetil Golid",
      description: snapshots.ARCHETYPE_DESCRIPTION,
      scriptJson:
        '{"type":"p5js","version":"1.0.0","aspectRatio":"1","curation_status":"curated"}',
      name: "Archetype",
      maxInvocations: 600,
    });
  });

  it("parses a response with line breaks in description", () => {
    expect(parseProjectData(snapshots.HYPERHASH, rawHyperhash)).toEqual({
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

  it("parses a phantom project response", () => {
    expect(
      parseProjectData(snapshots.PHANTOM_SEADRAGONS, rawPhantomSeadragons)
    ).toBe(null);
  });
});
