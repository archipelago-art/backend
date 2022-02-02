const slugify = require("./slugify");

describe("slugify", () => {
  it("handles explicit special cases", () => {
    // project "Gazers", feature name
    expect(slugify("🌕🎨 Variance")).toEqual("moon-variance");
    // project "Low Tide", feature "Starfish"
    expect(slugify("✓")).toEqual("checkmark");
  });

  it("separates positive and negative numbers", () => {
    // project "Nimbuds", feature "Eyebrow Angle"
    expect(slugify("45")).toEqual("45");
    expect(slugify("-45")).toEqual("-45");
  });

  it("separates numbers that differ only in decimal point location", () => {
    // project "I Saw It in a Dream", feature "Layer 2 Weight"
    expect(slugify("1.6")).toEqual("1.6");
    expect(slugify("16")).toEqual("16");
  });

  it("keeps numbers separated in hyphenated WORDs", () => {
    // project "algorhythms", feature "Music Scale"
    expect(slugify("Phrygian (1-2-6)")).toEqual("phrygian-1-2-6");
  });

  it("keeps numbers separated in colon-separated WORDs", () => {
    // project "hyperhash", feature "Dimensions Ratio"
    expect(slugify("3:4:3")).toEqual("3-4-3");
  });

  it("keeps numbers separated in slash-separated WORDs", () => {
    // project "heavenly-bodies", feature "Top Position"
    expect(slugify("1/2")).toEqual("1-2");
  });

  it("keeps numbers separated in colon- and slash-separated WORDs", () => {
    // project "heavenly-bodies", feature "\u{1f311}\u{1f4c5}"
    expect(slugify("10/28/2019 03:38")).toEqual("10-28-2019-03-38");
  });

  it("glues numbers to delimiters like '3x3' and '80s music'", () => {
    // project "ringers", feature "Peg layout"
    expect(slugify("a 3x3 grid")).toEqual("a-3x3-grid");
    expect(slugify("80s music")).toEqual("80s-music");
    expect(slugify("90's music")).toEqual("90s-music");
  });

  it("keeps numbers separate from adjacent words", () => {
    // project "void", feature "Palette"
    expect(slugify("teal to 11")).toEqual("teal-to-11");
    // project "rotae", feature "Palette"
    expect(slugify("80s pastel")).toEqual("80s-pastel");
    // project "autorad", feature "Shape"
    // (this one has an apostrophe in the source text)
    expect(slugify("90's notebook circle")).toEqual("90s-notebook-circle");
  });

  it("doesn't preserve non-numeric decimal points", () => {
    // project "Gen 3", feature "Word 2"
    expect(slugify("artblocks.io")).toEqual("artblocksio");
    // project "Democracity", feature "Weather"
    expect(slugify("Overcast w. Precipitation")).toEqual(
      "overcast-w-precipitation"
    );
  });
});
