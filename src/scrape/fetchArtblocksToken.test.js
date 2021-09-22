const { parseTokenData } = require("./fetchArtblocksToken");
const snapshots = require("./snapshots");

describe("scrape/fetchArtblocksToken", () => {
  let rawCube;
  beforeAll(async () => {
    rawCube = await snapshots.readToken(snapshots.THE_CUBE);
  });

  it("handles fetch failures", () => {
    expect(parseTokenData(null)).toEqual({ found: false });
  });

  it("parses a successful response", () => {
    expect(parseTokenData(rawCube)).toEqual({
      found: true,
      raw: rawCube,
      parsed: expect.objectContaining({
        tokenID: String(snapshots.THE_CUBE),
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
});
