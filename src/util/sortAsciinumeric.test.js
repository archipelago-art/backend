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

  it("handles mixed alphabetical and numeric hyphenated strings", () => {
    const input = ["1-in-23", "1-in-9", "1-in-100"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["1-in-9", "1-in-23", "1-in-100"]);
  });

  it("treats strings with more parts as larger, all else equal", () => {
    const input = ["Left-tilt", "Left", "Right-tilt", "Right"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["Left", "Left-tilt", "Right", "Right-tilt"]);
  });

  it("handles numeric English strings", () => {
    const input = [
      "Eight flowers",
      "Five flowers",
      "Four flowers",
      "Nine flowers",
      "None",
      "One flower",
      "Seven flowers",
      "Six flowers",
      "Ten flowers",
      "Three flowers",
      "Two flowers",
    ];
    const output = sortAsciinumeric(input);
    const expected = [
      "None",
      "One flower",
      "Two flowers",
      "Three flowers",
      "Four flowers",
      "Five flowers",
      "Six flowers",
      "Seven flowers",
      "Eight flowers",
      "Nine flowers",
      "Ten flowers",
    ];
    expect(output).toEqual(expected);
  });

  it("handles hyphenated numeric English strings", () => {
    const input = [
      "eight-flowers",
      "five-flowers",
      "four-flowers",
      "nine-flowers",
      "none",
      "one-flower",
      "seven-flowers",
      "six-flowers",
      "ten-flowers",
      "three-flowers",
      "two-flowers",
    ];
    const output = sortAsciinumeric(input);
    const expected = [
      "none",
      "one-flower",
      "two-flowers",
      "three-flowers",
      "four-flowers",
      "five-flowers",
      "six-flowers",
      "seven-flowers",
      "eight-flowers",
      "nine-flowers",
      "ten-flowers",
    ];
    expect(output).toEqual(expected);
  });

  it('sorts "None" before categorical values', () => {
    // This is really a side-effect of treating "None" as a number, but it's
    // kind of nice, so let's at least document it.
    const input = ["Contracting", "Expanding", "None"];
    const output = sortAsciinumeric(input);
    expect(output).toEqual(["None", "Contracting", "Expanding"]);
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
