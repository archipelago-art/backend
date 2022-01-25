const sortAsciinumeric = require("./sortAsciinumeric");

describe("util/sortAsciinumeric", () => {
  it("handles all-alphabetical strings", () => {
    const input = ["Cove", "Archipelago", "Glacier", "Dune"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["Archipelago", "Cove", "Dune", "Glacier"]);
  });

  it("handles all-numeric strings", () => {
    const input = ["23", "9", "100"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["9", "23", "100"]);
  });

  it("handles mixed alphabetical and numeric strings", () => {
    const input = ["1 in 23", "1 in 9", "1 in 100"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["1 in 9", "1 in 23", "1 in 100"]);
  });

  it("treats strings with more parts as larger, all else equal", () => {
    const input = ["Left-tilt", "Left", "Right-tilt", "Right"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["Left", "Left-tilt", "Right", "Right-tilt"]);
  });

  it("allows projecting keys", () => {
    const input = [
      { value: "1 in 23", id: "a" },
      { value: "1 in 9", id: "b" },
      { value: "1 in 100", id: "c" },
    ];
    const output = sortAsciinumeric(input, (x) => x.value);
    expect(output).toEqual([
      { value: "1 in 9", id: "b" },
      { value: "1 in 23", id: "a" },
      { value: "1 in 100", id: "c" },
    ]);
  });

  it("reports a nice error if the key extractor fails", () => {
    const input = [
      { value: "1 in 23", id: "a" },
      { notValue: "1 in 100", id: "c" },
    ];
    expect(() => sortAsciinumeric(input, (x) => x.value)).toThrow(
      "key function returned non-string: undefined"
    );
  });
});
