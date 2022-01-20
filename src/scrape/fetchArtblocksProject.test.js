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
      script: expect.stringMatching(
        // Make sure that HTML entities like "&amp;" and "&lt;" get decoded.
        /^(?:let seed=).*(?:is_bright&&rng\(\)<\.25).*(?:})$/s
      ),
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
      script: expect.stringContaining("return new p5.Shader"),
    });
  });

  it("parses a no-such-project response", () => {
    expect(
      parseProjectData(9999, JSON.stringify({ data: { projects: [] } }))
    ).toBe(null);
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
