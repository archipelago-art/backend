const { parseTokenData } = require("./fetchArtblocksToken");
const snapshots = require("./snapshots");

describe("scrape/fetchArtblocksToken", () => {
  const sc = new snapshots.SnapshotCache();

  it("handles fetch failures", () => {
    expect(parseTokenData(null)).toEqual({ found: false });
  });

  it("parses a successful response", async () => {
    const rawCube = await sc.token(snapshots.THE_CUBE);
    expect(parseTokenData(rawCube)).toEqual({
      found: true,
      raw: rawCube,
      parsed: expect.objectContaining({
        tokenID: String(snapshots.THE_CUBE.onChainTokenId),
        name: "Archetype #250",
        features: {
          Scene: "Cube",
          Framed: "Yep",
          Layout: "Chaos",
          Palette: "Paddle",
          Shading: "Bright Morning",
          "Coloring strategy": "Single",
        },
      }),
    });
  });

  describe("empty features", () => {
    it("are allowed for projects like Elevated Deconstructions, where that's intended", async () => {
      const raw = await sc.token(
        snapshots.ELEVATED_DECONSTRUCTIONS_EMPTY_FEATURES
      );
      expect(parseTokenData(raw, { checkFeaturesPresent: true })).toEqual({
        found: true,
        raw,
        parsed: expect.objectContaining({
          features: {},
        }),
      });
    });

    it("are forbidden for projects like ByteBeats, where that's unintended", async () => {
      const raw = await sc.token(snapshots.BYTEBEATS_EMPTY_FEATURES);
      expect(() => parseTokenData(raw, { checkFeaturesPresent: true })).toThrow(
        'empty "features"'
      );
    });

    it("are allowed when feature checking is disabled", async () => {
      const raw = await sc.token(snapshots.BYTEBEATS_EMPTY_FEATURES);
      expect(parseTokenData(raw, { checkFeaturesPresent: false })).toEqual({
        found: true,
        raw,
        parsed: expect.objectContaining({ features: {} }),
      });
    });
  });
});
