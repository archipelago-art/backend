const normalizeAspectRatio = require("./normalizeAspectRatio");

describe("scrape/normalizeAspectRatio", () => {
  it("gives reasonable answers for the data from projects 0 through 291", () => {
    const cases = [
      [0.833333, 0.833333],
      [1, 1],
      ["0.5625", 0.5625],
      ["0.714286", 0.714286],
      ["0.8", 0.8],
      ["0.833333", 0.833333],
      ["0.8333333333333334", 0.8333333333333334],
      [".9", 0.9],
      ["1", 1],
      ["1.0", 1.0],
      ["1.1", 1.1],
      ["1/1", 1 / 1],
      ["1.33", 1.33],
      ["1.5", 1.5],
      ["1.7", 1.7],
      ["1.75", 1.75],
      ["1.77", 1.77],
      ["1.77777", 1.77777],
      ["1.77777778", 1.77777778],
      ["3/4", 3 / 4],
      ["4", 4],
      ["4/3", 4 / 3],
    ];
    const actual = cases.map(([input, expected]) => ({
      input,
      actual: normalizeAspectRatio(input),
      expected,
    }));
    const expected = cases.map(([input, expected]) => ({
      input,
      actual: expected,
      expected,
    }));
    expect(actual).toEqual(expected);
  });

  it("throws on `null`", () => {
    expect(() => normalizeAspectRatio(null)).toThrow(
      "nullish aspect ratio: null"
    );
  });
});
