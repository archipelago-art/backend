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

  it("doesn't preserve non-numeric decimal points", () => {
    // project "Gen 3", feature "Word 2"
    expect(slugify("artblocks.io")).toEqual("artblocksio");
    // project "Democracity", feature "Weather"
    expect(slugify("Overcast w. Precipitation")).toEqual(
      "overcast-w-precipitation"
    );
  });
});
